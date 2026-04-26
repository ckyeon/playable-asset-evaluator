import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { getDb } from "@/lib/db/client";
import { assetAbsolutePath } from "@/lib/files/paths";
import { AssetStorage } from "@/lib/services/asset-storage";
import { EvaluationRunner } from "@/lib/services/evaluation-runner";
import { ExportBuilder } from "@/lib/services/export-builder";
import { JudgmentStore } from "@/lib/services/judgment-store";
import { LocalCliEvaluationAdapter, type CliRunRequest } from "@/lib/services/local-cli-evaluation-adapter";
import { createImageFile, useTempDataDir } from "../helpers";

const validCliOutput = {
  fit_score: 88,
  criteria: [
    { criterion: "profile_fit", score: 88, reason: "Fits the style profile." },
    { criterion: "source_asset_match", score: 86, reason: "Matches the source assets." },
    { criterion: "prompt_intent_match", score: 90, reason: "Matches the prompt intent." },
    { criterion: "production_usability", score: 84, reason: "Production usable." }
  ],
  ai_summary: "Candidate is strong against the context.",
  suggested_decision: "good",
  target_use_decision: "good",
  asset_quality_decision: "good",
  next_prompt_guidance: "Keep the character and preserve clean layer separation.",
  confidence_state: "normal"
};

describe("asset evaluator workflow", () => {
  it("uploads references and candidate, runs mock evaluation, saves judgment, and exports", async () => {
    useTempDataDir();
    process.env.EVALUATION_MODEL = "mock-evaluator-v1";
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const storage = new AssetStorage();
    const references: Array<{ id: string; file_path: string; thumbnail_path: string | null }> = [];

    for (const [index, color] of ["#cf3030", "#d99d22", "#2f6f73"].entries()) {
      const reference = await storage.saveReferenceAsset({
        styleProfileId: profile.id,
        file: await createImageFile(`reference-${index}.png`, "image/png", color),
        assetType: "card",
        note: `reference ${index}`
      });
      expect(existsSync(assetAbsolutePath(reference.file_path))).toBe(true);
      expect(reference.thumbnail_path ? existsSync(assetAbsolutePath(reference.thumbnail_path)) : true).toBe(true);
      references.push(reference);
    }

    const candidate = await storage.saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("candidate.webp", "image/webp", "#d89126"),
      promptText: "Create a bright Korean card casino slot reward symbol."
    });

    const draft = await new EvaluationRunner().evaluateCandidate(candidate.id);
    expect(draft.criteria).toHaveLength(4);
    expect(draft.evaluation.evaluation_state).toBe("draft");

    const saved = new JudgmentStore().saveJudgment({
      candidateId: candidate.id,
      decisionLabel: "needs_edit",
      humanReason: "The shape is usable, but reward lighting needs to match the references.",
      promptText: "Create a bright Korean card casino slot reward symbol.",
      nextPromptGuidance: draft.next_prompt_guidance
    });
    expect(saved.evaluation.evaluation_state).toBe("saved");

    const exported = new ExportBuilder().buildJson(profile.id) as {
      contexts: Array<{ candidates: unknown[] }>;
      agent_dataset_items: Array<{ next_prompt_guidance: { human_modified: boolean } | null }>;
    };
    expect(exported.contexts[0].candidates).toHaveLength(1);
    expect(exported.agent_dataset_items[0].next_prompt_guidance).toMatchObject({ human_modified: false });
    expect(new ExportBuilder().buildMarkdown(profile.id)).toContain("needs_edit");

    const candidateFilePath = candidate.file_path;
    const candidateThumbnailPath = candidate.thumbnail_path;
    await storage.deleteCandidateImage(candidate.id);
    expect(db.prepare("SELECT id FROM candidate_images WHERE id = ?").get(candidate.id)).toBeUndefined();
    expect(db.prepare("SELECT id FROM evaluations WHERE candidate_image_id = ?").get(candidate.id)).toBeUndefined();
    expect(db.prepare("SELECT id FROM prompt_guidance").get()).toBeUndefined();
    expect(existsSync(assetAbsolutePath(candidateFilePath))).toBe(false);
    if (candidateThumbnailPath) {
      expect(existsSync(assetAbsolutePath(candidateThumbnailPath))).toBe(false);
    }

    const reference = references[0];
    await storage.deleteReferenceAsset(reference.id);
    expect(db.prepare("SELECT id FROM reference_assets WHERE id = ?").get(reference.id)).toBeUndefined();
    expect(existsSync(assetAbsolutePath(reference.file_path))).toBe(false);
    if (reference.thumbnail_path) {
      expect(existsSync(assetAbsolutePath(reference.thumbnail_path))).toBe(false);
    }
  });

  it("stores a draft evaluation from a local CLI adapter without calling a real provider", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const storage = new AssetStorage();
    for (const [index, color] of ["#cf3030", "#d99d22", "#2f6f73"].entries()) {
      await storage.saveReferenceAsset({
        styleProfileId: profile.id,
        file: await createImageFile(`local-reference-${index}.png`, "image/png", color),
        assetType: "character",
        note: `local reference ${index}`
      });
    }
    const candidate = await storage.saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("local-candidate.png", "image/png", "#7349d1"),
      promptText: "Create the same character in a nervous pose."
    });
    let request: CliRunRequest | null = null;
    const adapter = new LocalCliEvaluationAdapter({
      provider: "gemini",
      modelName: "gemini-cli",
      timeoutMs: 120_000,
      runner: async (runRequest) => {
        request = runRequest;
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            session_id: "gemini-session",
            response: JSON.stringify({
              ...validCliOutput,
              fit_score: 0.88,
              criteria: {
                profile_fit: { score: 0.88, reason: "Fits the style profile." },
                source_asset_match: { score: 8.6, reason: "Matches the source assets." },
                prompt_intent_match: { score: 90, reason: "Matches the prompt intent." },
                production_usability: { score: 84, reason: "Production usable." }
              }
            })
          }),
          stderr: "Keychain warning that should not fail the result.",
          timedOut: false
        };
      }
    });

    const draft = await new EvaluationRunner(adapter, "gemini-cli").evaluateCandidate(candidate.id);

    expect(request).toMatchObject({ command: "gemini", shell: false });
    expect(draft.evaluation).toMatchObject({
      model_name: "gemini-cli",
      evaluation_state: "draft",
      decision_label: "good",
      fit_score: 88
    });
    expect(draft.criteria).toHaveLength(4);
    expect(draft.next_prompt_guidance).toBe("Keep the character and preserve clean layer separation.");
    expect(JSON.parse(draft.evaluation.raw_model_output_json || "{}")).toMatchObject({
      target_use_decision: "good",
      asset_quality_decision: "good"
    });
  });

  it("persists failed evaluations when Gemini returns scoreless criteria", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const storage = new AssetStorage();
    const candidate = await storage.saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("scoreless-gemini-candidate.png", "image/png", "#7349d1"),
      promptText: "Create the same character in a nervous pose."
    });
    const adapter = new LocalCliEvaluationAdapter({
      provider: "gemini",
      modelName: "gemini-cli",
      timeoutMs: 120_000,
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          response: JSON.stringify({
            ...validCliOutput,
            fit_score: 0.88,
            criteria: {
              profile_fit: "Fits the style profile.",
              source_asset_match: "Matches the source assets.",
              prompt_intent_match: "Matches the prompt intent.",
              production_usability: "Production usable."
            }
          })
        }),
        stderr: "",
        timedOut: false
      })
    });

    await expect(new EvaluationRunner(adapter, "gemini-cli").evaluateCandidate(candidate.id)).rejects.toThrow(
      "Model returned invalid evaluation JSON."
    );
    const failed = db
      .prepare("SELECT evaluation_state, ai_summary, raw_model_output_json FROM evaluations WHERE candidate_image_id = ?")
      .get(candidate.id) as {
      evaluation_state: string;
      ai_summary: string;
      raw_model_output_json: string;
    };
    expect(failed).toMatchObject({
      evaluation_state: "failed",
      ai_summary: "Model returned invalid evaluation JSON."
    });
    expect(JSON.parse(failed.raw_model_output_json)).toMatchObject({ fit_score: 88 });
  });

  it("persists failed evaluations from local CLI process failures", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const storage = new AssetStorage();
    const candidate = await storage.saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("failed-local-candidate.png", "image/png", "#7349d1"),
      promptText: "Create the same character in a nervous pose."
    });
    const adapter = new LocalCliEvaluationAdapter({
      provider: "codex",
      modelName: "codex-cli",
      timeoutMs: 120_000,
      runner: async () => ({ exitCode: 1, stdout: "", stderr: "not logged in", timedOut: false })
    });

    await expect(new EvaluationRunner(adapter, "codex-cli").evaluateCandidate(candidate.id)).rejects.toThrow(
      "Evaluation CLI failed."
    );

    const failed = db
      .prepare("SELECT model_name, evaluation_state, ai_summary, raw_model_output_json FROM evaluations WHERE candidate_image_id = ?")
      .get(candidate.id) as {
      model_name: string;
      evaluation_state: string;
      ai_summary: string;
      raw_model_output_json: string;
    };
    expect(failed).toMatchObject({
      model_name: "codex-cli",
      evaluation_state: "failed",
      ai_summary: "Evaluation CLI failed."
    });
    expect(JSON.parse(failed.raw_model_output_json)).toMatchObject({
      provider: "codex",
      stderr: "not logged in",
      exit_code: 1
    });
  });
});
