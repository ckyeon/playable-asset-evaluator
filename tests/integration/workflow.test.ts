import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { getDb } from "@/lib/db/client";
import { assetAbsolutePath } from "@/lib/files/paths";
import { AssetStorage } from "@/lib/services/asset-storage";
import { EvaluationRunner } from "@/lib/services/evaluation-runner";
import { ExportBuilder } from "@/lib/services/export-builder";
import { JudgmentStore } from "@/lib/services/judgment-store";
import { createImageFile, useTempDataDir } from "../helpers";

describe("asset evaluator workflow", () => {
  it("uploads references and candidate, runs mock evaluation, saves judgment, and exports", async () => {
    useTempDataDir();
    process.env.EVALUATION_MODEL = "mock-evaluator-v1";
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const session = db.prepare("SELECT id FROM evaluation_sessions LIMIT 1").get() as { id: string };
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
      sessionId: session.id,
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

    const exported = new ExportBuilder().buildJson(profile.id) as { sessions: Array<{ candidates: unknown[] }> };
    expect(exported.sessions[0].candidates).toHaveLength(1);
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
});
