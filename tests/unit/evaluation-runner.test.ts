import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path, { dirname, join } from "node:path";
import { parseModelEvaluation } from "@/lib/model/evaluation-schema";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { liveEvalGateFailures, parseLiveEvalArgs, recordLiveEvalComparison, shouldFailLiveEval } from "@/scripts/eval-live";
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
  normalizeProviderOutput,
  parseLocalCliStdout,
  runCliProcess
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
  target_use_decision: "good",
  asset_quality_decision: "good",
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
    expect(geminiPrompt).toContain("Do not use 0..1 scores. Do not use 1..10 scores.");
    expect(geminiPrompt).toContain("Do not return criteria as an object map.");
    expect(geminiPrompt).toContain("\"fit_score\": 84");
    expect(geminiPrompt).toContain("\"criteria\": [");
    expect(geminiPrompt).toContain("Separate target-use fit from asset quality.");
    expect(geminiPrompt).toContain("asset_quality_decision=good but target_use_decision=reject");

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

  it("requires suggested_decision to match target_use_decision", () => {
    expect(parseModelEvaluation(validModelOutput)).toMatchObject({
      suggested_decision: "good",
      target_use_decision: "good",
      asset_quality_decision: "good"
    });
    expect(() =>
      parseModelEvaluation({
        ...validModelOutput,
        suggested_decision: "good",
        target_use_decision: "needs_edit"
      })
    ).toThrow();
  });

  it("normalizes Gemini score scales without inventing missing criterion scores", () => {
    expect(normalizeProviderOutput({ ...validModelOutput, fit_score: 0.98 })).toMatchObject({ fit_score: 98 });
    expect(normalizeProviderOutput({ ...validModelOutput, fit_score: 9 })).toMatchObject({ fit_score: 90 });
    expect(normalizeProviderOutput({ ...validModelOutput, fit_score: 84 })).toMatchObject({ fit_score: 84 });
    expect(
      normalizeProviderOutput({
        ...validModelOutput,
        criteria: [
          { criterion: "profile_fit", score: 0.8, reason: "Fits." },
          { criterion: "source_asset_match", score: 8, reason: "Matches." },
          { criterion: "prompt_intent_match", score: 85, reason: "Aligned." },
          { criterion: "production_usability", score: 72.4, reason: "Usable." }
        ]
      })
    ).toMatchObject({
      criteria: [
        { criterion: "profile_fit", score: 80 },
        { criterion: "source_asset_match", score: 80 },
        { criterion: "prompt_intent_match", score: 85 },
        { criterion: "production_usability", score: 72 }
      ]
    });

    const scorelessCriteria = normalizeProviderOutput({
      ...validModelOutput,
      criteria: {
        profile_fit: "Looks right.",
        source_asset_match: "Matches references.",
        prompt_intent_match: "Matches prompt.",
        production_usability: "Usable."
      }
    });
    expect(() => parseModelEvaluation(scorelessCriteria)).toThrow();
  });

  it("normalizes Gemini envelope responses into schema-valid output when scores are present", () => {
    const output = parseLocalCliStdout(
      JSON.stringify({
        session_id: "session-1",
        response: JSON.stringify({
          ...validModelOutput,
          fit_score: 0.98,
          criteria: {
            profile_fit: { score: 0.9, reason: "Fits." },
            source_asset_match: { score: 8, reason: "Matches." },
            prompt_intent_match: { score: 86, reason: "Aligned." },
            production_usability: { score: 72.4, reason: "Usable." }
          }
        })
      })
    );
    expect(parseModelEvaluation(output)).toMatchObject({
      fit_score: 98,
      criteria: [
        { criterion: "profile_fit", score: 90 },
        { criterion: "source_asset_match", score: 80 },
        { criterion: "prompt_intent_match", score: 86 },
        { criterion: "production_usability", score: 72 }
      ]
    });
  });

  it("treats complete Gemini stdout JSON as success even if the process keeps running", async () => {
    const result = await runCliProcess({
      provider: "gemini",
      command: process.execPath,
      args: [
        "-e",
        `process.stdout.write(JSON.stringify({ response: ${JSON.stringify(JSON.stringify(validModelOutput))} })); setInterval(() => {}, 1000);`
      ],
      input: "",
      timeoutMs: 1_000,
      cwd: process.cwd(),
      shell: false
    });

    expect(result).toMatchObject({
      exitCode: 0,
      timedOut: false
    });
    expect(parseModelEvaluation(parseLocalCliStdout(result.stdout))).toMatchObject({ fit_score: 84 });
  });

  it("does not treat non-result Gemini JSON as completed evaluator output", async () => {
    const result = await runCliProcess({
      provider: "gemini",
      command: process.execPath,
      args: ["-e", `process.stdout.write(JSON.stringify({ type: "status" })); setInterval(() => {}, 1000);`],
      input: "",
      timeoutMs: 1_000,
      cwd: process.cwd(),
      shell: false
    });

    expect(result).toMatchObject({
      exitCode: null,
      stdout: JSON.stringify({ type: "status" }),
      timedOut: true
    });
  });

  it("fails live eval on CLI failures or strict label mismatches", () => {
    expect(shouldFailLiveEval({ failures: 0, target_misses: 0, quality_misses: 0 })).toBe(false);
    expect(liveEvalGateFailures({ failures: 0, target_misses: 0, quality_misses: 0 })).toEqual([]);

    expect(shouldFailLiveEval({ failures: 1, target_misses: 0, quality_misses: 0 })).toBe(true);
    expect(liveEvalGateFailures({ failures: 1, target_misses: 2, quality_misses: 3 })).toEqual([
      "cli_failures=1",
      "target_use_misses=2",
      "asset_quality_misses=3"
    ]);
    expect(shouldFailLiveEval({ failures: 0, target_misses: 1, quality_misses: 0 })).toBe(true);
    expect(shouldFailLiveEval({ failures: 0, target_misses: 0, quality_misses: 1 })).toBe(true);
  });

  it("records live eval target and quality matches separately", () => {
    const summary = {
      total: 2,
      completed: 0,
      failures: 0,
      target_matches: 0,
      target_misses: 0,
      quality_matches: 0,
      quality_misses: 0
    };
    const first = recordLiveEvalComparison(
      summary,
      { targetUseDecision: "reject", qualityDecision: "good" },
      { targetUseDecision: "reject", qualityDecision: "good" }
    );
    const second = recordLiveEvalComparison(
      summary,
      { targetUseDecision: "needs_edit", qualityDecision: "good" },
      { targetUseDecision: "good", qualityDecision: "good" }
    );

    expect(first).toEqual({ targetOk: true, qualityOk: true });
    expect(second).toEqual({ targetOk: false, qualityOk: true });
    expect(summary).toMatchObject({
      target_matches: 1,
      target_misses: 1,
      quality_matches: 2,
      quality_misses: 0
    });
  });

  it("defaults live eval concurrency to five and accepts explicit overrides", () => {
    const defaults = parseLiveEvalArgs(["--provider", "gemini"], {});
    expect(defaults.datasetRoot).toBe(path.resolve("tests/evals/ai-character-chat"));
    expect(defaults.concurrency).toBe(5);
    expect(parseLiveEvalArgs(["--provider", "codex", "--concurrency", "2"]).concurrency).toBe(2);
    expect(() => parseLiveEvalArgs(["--concurrency", "0"])).toThrow(
      "Live eval concurrency must be a positive integer."
    );
  });

  it("defaults live eval timeout to 240 seconds and accepts env or explicit overrides", () => {
    expect(parseLiveEvalArgs(["--provider", "gemini"], {}).timeoutMs).toBe(240_000);
    expect(parseLiveEvalArgs(["--provider", "gemini"], { EVALUATOR_TIMEOUT_MS: "180000" }).timeoutMs).toBe(180_000);
    expect(parseLiveEvalArgs(["--provider", "gemini", "--timeout-ms", "300000"], {}).timeoutMs).toBe(300_000);
    expect(() => parseLiveEvalArgs(["--provider", "gemini", "--timeout-ms", "0"], {})).toThrow(
      "Live eval timeout must be a positive integer."
    );
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
      sha256: null,
      byte_size: null,
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
        sha256: null,
        byte_size: null,
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
