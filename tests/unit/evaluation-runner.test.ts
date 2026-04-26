import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { EvaluationAdapterError } from "@/lib/services/evaluation-adapter-error";
import {
  createModelAdapterFromEnv,
  resolveEvaluationRunnerConfig,
  type EvaluationContext,
  type ModelAdapter
} from "@/lib/services/evaluation-adapters";
import { EvaluationRunner } from "@/lib/services/evaluation-runner";
import {
  buildLocalCliPrompt,
  buildLocalCliRunRequest,
  LocalCliEvaluationAdapter,
  parseLocalCliStdout
} from "@/lib/services/local-cli-evaluation-adapter";
import { MockEvaluationAdapter } from "@/lib/services/mock-evaluation-adapter";
import { useTempDataDir } from "../helpers";

const validModelOutput = {
  fit_score: 84,
  criteria: [
    { criterion: "profile_fit", score: 84, reason: "Fits the style profile." },
    { criterion: "source_asset_match", score: 82, reason: "Matches the source assets." },
    { criterion: "prompt_intent_match", score: 85, reason: "Matches the prompt intent." },
    { criterion: "production_usability", score: 80, reason: "Usable in production." }
  ],
  ai_summary: "Candidate fits the generation context.",
  suggested_decision: "good",
  next_prompt_guidance: "Keep the same character and improve asset separation.",
  confidence_state: "normal"
};

describe("EvaluationRunner", () => {
  it("caps the selected reference subset at eight assets", () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };

    for (let index = 0; index < 10; index += 1) {
      db.prepare(
        `INSERT INTO reference_assets (id, style_profile_id, asset_type, file_path, thumbnail_path, note, pinned)
         VALUES (?, ?, 'card', ?, NULL, ?, ?)`
      ).run(randomUUID(), profile.id, `assets/ref-${index}.png`, `ref ${index}`, index < 2 ? 1 : 0);
    }

    const subset = new EvaluationRunner().selectReferenceSubset(profile.id);
    expect(subset.references).toHaveLength(8);
    expect(subset.weakReferenceSet).toBe(false);
  });

  it("marks fewer than three references as a weak reference set", () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    db.prepare(
      `INSERT INTO reference_assets (id, style_profile_id, asset_type, file_path)
       VALUES (?, ?, 'card', 'assets/ref.png')`
    ).run(randomUUID(), profile.id);

    const subset = new EvaluationRunner().selectReferenceSubset(profile.id);
    expect(subset.references).toHaveLength(1);
    expect(subset.weakReferenceSet).toBe(true);
  });

  it("selects the mock adapter by default and local CLI when configured", () => {
    expect(createModelAdapterFromEnv({})).toBeInstanceOf(MockEvaluationAdapter);
    expect(createModelAdapterFromEnv({ EVALUATION_ADAPTER: "local-cli" })).toBeInstanceOf(LocalCliEvaluationAdapter);
    expect(() => createModelAdapterFromEnv({ EVALUATION_ADAPTER: "remote" })).toThrow(
      "EVALUATION_ADAPTER must be 'mock' or 'local-cli'."
    );
    expect(() =>
      createModelAdapterFromEnv({ EVALUATION_ADAPTER: "local-cli", EVALUATOR_PROVIDER: "llama" })
    ).toThrow("EVALUATOR_PROVIDER must be 'gemini' or 'codex'.");
  });

  it("resolves evaluator model name and timeout config with legacy fallback", () => {
    expect(resolveEvaluationRunnerConfig({}).modelName).toBe("mock-evaluator-v1");
    expect(resolveEvaluationRunnerConfig({ EVALUATION_MODEL: "legacy-model" }).modelName).toBe("legacy-model");
    expect(
      resolveEvaluationRunnerConfig({
        EVALUATION_ADAPTER: "local-cli",
        EVALUATOR_PROVIDER: "codex",
        EVALUATOR_MODEL_NAME: "gpt-5.2",
        EVALUATOR_TIMEOUT_MS: "42"
      })
    ).toMatchObject({
      adapterName: "local-cli",
      provider: "codex",
      modelName: "gpt-5.2",
      timeoutMs: 42
    });
    expect(() => resolveEvaluationRunnerConfig({ EVALUATOR_TIMEOUT_MS: "-1" })).toThrow(
      "EVALUATOR_TIMEOUT_MS must be a positive number."
    );
  });

  it("builds Gemini and Codex CLI requests without shell execution", () => {
    const files = {
      candidatePath: "/tmp/candidate.png",
      sourceAssetPaths: ["/tmp/source-a.png", "/tmp/source-b.png"]
    };
    const gemini = buildLocalCliRunRequest({
      provider: "gemini",
      prompt: "Evaluate this image",
      files,
      timeoutMs: 120_000,
      schemaPath: null
    });
    expect(gemini).toMatchObject({
      provider: "gemini",
      command: "gemini",
      shell: false,
      input: "",
      timeoutMs: 120_000
    });
    expect(gemini.args).toEqual(
      expect.arrayContaining(["--prompt", "Evaluate this image", "--output-format", "json"])
    );

    const codex = buildLocalCliRunRequest({
      provider: "codex",
      prompt: "Evaluate this image",
      files,
      timeoutMs: 120_000,
      schemaPath: "/tmp/schema.json"
    });
    expect(codex).toMatchObject({
      provider: "codex",
      command: "codex",
      shell: false,
      input: "Evaluate this image",
      timeoutMs: 120_000
    });
    expect(codex.args).toEqual(
      expect.arrayContaining([
        "exec",
        "--sandbox",
        "read-only",
        "--output-schema",
        "/tmp/schema.json",
        "--image",
        "/tmp/candidate.png",
        "--image",
        "/tmp/source-a.png",
        "-"
      ])
    );
  });

  it("builds provider prompts that expose image paths and metadata", () => {
    const context = fakeEvaluationContext();
    const files = { candidatePath: "/tmp/candidate.png", sourceAssetPaths: ["/tmp/source.png"] };
    const geminiPrompt = buildLocalCliPrompt(context, files, "gemini");
    expect(geminiPrompt).toContain("Candidate image: @/tmp/candidate.png");
    expect(geminiPrompt).toContain("Source asset 1: @/tmp/source.png");
    expect(geminiPrompt).toContain("\"generation_goal\": \"Create reusable character poses.\"");

    const codexPrompt = buildLocalCliPrompt(context, files, "codex");
    expect(codexPrompt).toContain("Candidate image and source assets are attached with CLI image inputs.");
    expect(codexPrompt).toContain("Candidate path for provenance: /tmp/candidate.png");
  });

  it("parses whole JSON stdout and rejects wrapped output", () => {
    expect(parseLocalCliStdout(JSON.stringify(validModelOutput))).toEqual(validModelOutput);
    expect(parseLocalCliStdout(JSON.stringify({ response: JSON.stringify(validModelOutput) }))).toEqual(validModelOutput);
    expect(() => parseLocalCliStdout("```json\n{}\n```")).toThrow();
    expect(() => parseLocalCliStdout("")).toThrow("Evaluation CLI returned empty JSON output.");
  });

  it("surfaces local CLI timeout and non-zero exit as adapter errors", async () => {
    useTempDataDir();
    writeFakeAsset("assets/candidate.png");
    writeFakeAsset("assets/source.png");
    const context = fakeEvaluationContext();
    const timeoutAdapter = new LocalCliEvaluationAdapter({
      provider: "gemini",
      modelName: "gemini-cli",
      timeoutMs: 10,
      runner: async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true })
    });
    await expect(timeoutAdapter.evaluate(context)).rejects.toMatchObject({
      message: "Evaluation CLI timed out."
    });

    const failedAdapter = new LocalCliEvaluationAdapter({
      provider: "gemini",
      modelName: "gemini-cli",
      timeoutMs: 10,
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "auth failed", timedOut: false })
    });
    await expect(failedAdapter.evaluate(context)).rejects.toMatchObject({
      message: "Evaluation CLI failed."
    });
  });

  it("rejects malformed local CLI JSON output", async () => {
    useTempDataDir();
    writeFakeAsset("assets/candidate.png");
    writeFakeAsset("assets/source.png");
    const adapter = new LocalCliEvaluationAdapter({
      provider: "gemini",
      modelName: "gemini-cli",
      timeoutMs: 10,
      runner: async () => ({ exitCode: 0, stdout: "not json", stderr: "", timedOut: false })
    });

    await expect(adapter.evaluate(fakeEvaluationContext())).rejects.toBeInstanceOf(EvaluationAdapterError);
  });

  it("stores a failed evaluation when an adapter throws", async () => {
    useTempDataDir();
    const db = getDb();
    const candidateId = insertCandidate(db);
    const adapter: ModelAdapter = {
      async evaluate() {
        throw new EvaluationAdapterError("Evaluation CLI failed.", { stderr: "auth failed" });
      }
    };

    await expect(new EvaluationRunner(adapter, "gemini-cli").evaluateCandidate(candidateId)).rejects.toThrow(
      "Evaluation CLI failed."
    );
    const failed = db.prepare("SELECT model_name, evaluation_state, ai_summary, raw_model_output_json FROM evaluations").get() as {
      model_name: string;
      evaluation_state: string;
      ai_summary: string;
      raw_model_output_json: string;
    };
    expect(failed).toMatchObject({
      model_name: "gemini-cli",
      evaluation_state: "failed",
      ai_summary: "Evaluation CLI failed."
    });
    expect(JSON.parse(failed.raw_model_output_json)).toEqual({ stderr: "auth failed" });
  });

  it("stores a failed evaluation when model JSON fails schema validation", async () => {
    useTempDataDir();
    const db = getDb();
    const candidateId = insertCandidate(db);
    const adapter: ModelAdapter = {
      async evaluate() {
        return { fit_score: 120 };
      }
    };

    await expect(new EvaluationRunner(adapter, "gemini-cli").evaluateCandidate(candidateId)).rejects.toThrow(
      "Model returned invalid evaluation JSON."
    );
    const failed = db.prepare("SELECT evaluation_state, raw_model_output_json FROM evaluations").get() as {
      evaluation_state: string;
      raw_model_output_json: string;
    };
    expect(failed.evaluation_state).toBe("failed");
    expect(JSON.parse(failed.raw_model_output_json)).toEqual({ fit_score: 120 });
  });

  it("fails before CLI execution when the candidate image file is missing", async () => {
    useTempDataDir();
    const db = getDb();
    const candidateId = insertCandidate(db, "assets/missing-candidate.png");
    let called = false;
    const adapter = new LocalCliEvaluationAdapter({
      provider: "gemini",
      modelName: "gemini-cli",
      timeoutMs: 10,
      runner: async () => {
        called = true;
        return { exitCode: 0, stdout: JSON.stringify(validModelOutput), stderr: "", timedOut: false };
      }
    });

    await expect(new EvaluationRunner(adapter, "gemini-cli").evaluateCandidate(candidateId)).rejects.toThrow(
      "Candidate image file is missing."
    );
    expect(called).toBe(false);
    expect(db.prepare("SELECT evaluation_state FROM evaluations").get()).toEqual({ evaluation_state: "failed" });
  });

  it("fails before CLI execution when a source asset file is missing", async () => {
    useTempDataDir();
    const db = getDb();
    const candidateId = insertCandidate(db, "assets/candidate.png", true);
    const context = db.prepare("SELECT generation_context_id FROM candidate_images WHERE id = ?").get(candidateId) as {
      generation_context_id: string;
    };
    db.prepare(
      `INSERT INTO generation_context_assets (id, generation_context_id, origin, asset_type, file_path)
       VALUES (?, ?, 'context_upload', 'character', 'assets/missing-source.png')`
    ).run(randomUUID(), context.generation_context_id);
    let called = false;
    const adapter = new LocalCliEvaluationAdapter({
      provider: "gemini",
      modelName: "gemini-cli",
      timeoutMs: 10,
      runner: async () => {
        called = true;
        return { exitCode: 0, stdout: JSON.stringify(validModelOutput), stderr: "", timedOut: false };
      }
    });

    await expect(new EvaluationRunner(adapter, "gemini-cli").evaluateCandidate(candidateId)).rejects.toThrow(
      "Source asset file is missing."
    );
    expect(called).toBe(false);
    expect(db.prepare("SELECT evaluation_state FROM evaluations").get()).toEqual({ evaluation_state: "failed" });
  });

  it("prevents duplicate evaluation runs for the same candidate", async () => {
    useTempDataDir();
    const db = getDb();
    const candidateId = insertCandidate(db);
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const adapter: ModelAdapter = {
      async evaluate() {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return validModelOutput;
      }
    };
    const runner = new EvaluationRunner(adapter, "mock-evaluator-v1");

    const first = runner.evaluateCandidate(candidateId);
    await startedPromise;
    await expect(runner.evaluateCandidate(candidateId)).rejects.toThrow("Evaluation is already running");
    release();
    await expect(first).resolves.toMatchObject({
      evaluation: { evaluation_state: "draft" }
    });
  });
});

function fakeEvaluationContext(): EvaluationContext {
  return {
    profile: {
      id: "profile-1",
      name: "Character profile",
      description: "A reusable character profile.",
      style_summary: "Bright mobile-game rendering.",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    },
    generationContext: {
      id: "context-1",
      style_profile_id: "profile-1",
      name: "Emotion pose batch",
      generation_goal: "Create reusable character poses.",
      asset_focus: "character",
      target_use: "Playable ad",
      source_prompt: "Create a nervous character pose.",
      tool_name: null,
      model_name: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z"
    },
    candidate: {
      id: "candidate-1",
      generation_context_id: "context-1",
      prompt_revision_id: null,
      file_path: "assets/candidate.png",
      thumbnail_path: null,
      generation_tool: null,
      prompt_text: "Create a nervous character pose.",
      prompt_missing: 0,
      source_integrity: "complete",
      recovery_note: null,
      created_at: "2026-01-01T00:00:00.000Z"
    },
    sourceAssets: [
      {
        id: "source-1",
        generation_context_id: "context-1",
        reference_asset_id: null,
        origin: "context_upload",
        asset_type: "character",
        file_path: "assets/source.png",
        thumbnail_path: null,
        snapshot_note: "Original character pose.",
        created_at: "2026-01-01T00:00:00.000Z"
      }
    ],
    weakReferenceSet: true
  };
}

function writeFakeAsset(filePath: string): void {
  const dataDir = process.env.ASSET_EVALUATOR_DATA_DIR!;
  const absolutePath = join(dataDir, filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, "image");
}

function insertCandidate(db: ReturnType<typeof getDb>, filePath = "assets/candidate.png", createFile = false): string {
  const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
  const candidateId = randomUUID();
  if (createFile) {
    writeFakeAsset(filePath);
  }
  db.prepare(
    `INSERT INTO candidate_images
      (id, generation_context_id, file_path, prompt_text, prompt_missing, source_integrity)
     VALUES (?, ?, ?, 'Create a candidate.', 0, 'complete')`
  ).run(candidateId, generationContext.id, filePath);
  return candidateId;
}
