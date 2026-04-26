import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { JudgmentStore } from "@/lib/services/judgment-store";
import { AssetStorage } from "@/lib/services/asset-storage";
import { EvaluationRunner } from "@/lib/services/evaluation-runner";
import { createImageFile, useTempDataDir } from "../helpers";

describe("JudgmentStore", () => {
  it("requires a human reason before saving", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const candidate = await new AssetStorage().saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("candidate.png"),
      promptText: "bright slot icon"
    });

    expect(() =>
      new JudgmentStore().saveJudgment({
        candidateId: candidate.id,
        decisionLabel: "needs_edit",
        humanReason: ""
      })
    ).toThrow(/Human reason/);
  });

  it("allows prompt-missing judgment only with a recovery note and marks low confidence", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const candidate = await new AssetStorage().saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("candidate.png"),
      promptMissing: true
    });

    expect(() =>
      new JudgmentStore().saveJudgment({
        candidateId: candidate.id,
        decisionLabel: "needs_edit",
        humanReason: "Direction is close, but prompt was not recovered.",
        promptMissing: true
      })
    ).toThrow(/Recovery note/);

    const result = new JudgmentStore().saveJudgment({
      candidateId: candidate.id,
      decisionLabel: "needs_edit",
      humanReason: "Direction is close enough to iterate.",
      promptMissing: true,
      recoveryNote: "Likely asked for a gold-red slot reward object."
    });

    expect(result.evaluation.confidence_state).toBe("low_confidence");
  });

  it("deletes draft prompt guidance when saving with blank guidance", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const candidate = await new AssetStorage().saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("candidate.png"),
      promptText: "bright slot icon"
    });

    const draft = await new EvaluationRunner().evaluateCandidate(candidate.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM prompt_guidance WHERE evaluation_id = ?").get(draft.evaluation.id)).toEqual({
      count: 1
    });

    const result = new JudgmentStore().saveJudgment({
      candidateId: candidate.id,
      decisionLabel: "needs_edit",
      humanReason: "The idea is close, but the silhouette needs cleanup.",
      nextPromptGuidance: ""
    });

    expect(result.evaluation.id).toBe(draft.evaluation.id);
    expect(result.guidance).toBeNull();
    expect(db.prepare("SELECT id FROM prompt_guidance WHERE evaluation_id = ?").get(result.evaluation.id)).toBeUndefined();
  });

  it("updates the latest saved judgment instead of duplicating it", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const candidate = await new AssetStorage().saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("candidate.png"),
      promptText: "bright slot icon"
    });
    const store = new JudgmentStore();
    const first = store.saveJudgment({
      candidateId: candidate.id,
      decisionLabel: "needs_edit",
      humanReason: "The first saved reason.",
      nextPromptGuidance: "Make the silhouette cleaner."
    });

    const second = store.saveJudgment({
      candidateId: candidate.id,
      decisionLabel: "reject",
      humanReason: "The revised saved reason.",
      nextPromptGuidance: ""
    });

    expect(second.evaluation.id).toBe(first.evaluation.id);
    expect(second.evaluation.decision_label).toBe("reject");
    expect(second.evaluation.human_reason).toBe("The revised saved reason.");
    expect(db.prepare("SELECT COUNT(*) AS count FROM evaluations WHERE candidate_image_id = ?").get(candidate.id)).toEqual({
      count: 1
    });
    expect(db.prepare("SELECT id FROM prompt_guidance WHERE evaluation_id = ?").get(second.evaluation.id)).toBeUndefined();
  });
});
