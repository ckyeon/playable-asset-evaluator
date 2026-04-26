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

  it("tracks unchanged and edited draft prompt guidance", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const store = new JudgmentStore();
    const unchangedCandidate = await new AssetStorage().saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("unchanged-candidate.png"),
      promptText: "bright slot icon"
    });

    const unchangedDraft = await new EvaluationRunner().evaluateCandidate(unchangedCandidate.id);
    expect(
      db.prepare("SELECT human_modified FROM prompt_guidance WHERE evaluation_id = ?").get(unchangedDraft.evaluation.id)
    ).toEqual({ human_modified: 0 });

    const unchangedSaved = store.saveJudgment({
      candidateId: unchangedCandidate.id,
      decisionLabel: "needs_edit",
      humanReason: "The idea is close, but the silhouette needs cleanup.",
      nextPromptGuidance: unchangedDraft.next_prompt_guidance
    });
    expect(unchangedSaved.guidance).toMatchObject({ human_modified: 0 });

    const unchangedResaved = store.saveJudgment({
      candidateId: unchangedCandidate.id,
      decisionLabel: "needs_edit",
      humanReason: "The same guidance still applies.",
      nextPromptGuidance: unchangedDraft.next_prompt_guidance
    });
    expect(unchangedResaved.guidance).toMatchObject({ id: unchangedSaved.guidance?.id, human_modified: 0 });

    const editedCandidate = await new AssetStorage().saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("edited-candidate.png"),
      promptText: "bright slot icon"
    });
    const editedDraft = await new EvaluationRunner().evaluateCandidate(editedCandidate.id);
    const editedSaved = store.saveJudgment({
      candidateId: editedCandidate.id,
      decisionLabel: "needs_edit",
      humanReason: "The AI guidance is close, but needs a more specific direction.",
      nextPromptGuidance: `${editedDraft.next_prompt_guidance} Add stronger rim light.`
    });

    expect(editedSaved.guidance).toMatchObject({ human_modified: 1 });
  });

  it("marks manual guidance as human modified and preserves it on unchanged resave", async () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const candidate = await new AssetStorage().saveCandidateImage({
      generationContextId: generationContext.id,
      file: await createImageFile("manual-guidance-candidate.png"),
      promptText: "bright slot icon"
    });
    const store = new JudgmentStore();

    const first = store.saveJudgment({
      candidateId: candidate.id,
      decisionLabel: "needs_edit",
      humanReason: "The shape is usable, but lighting needs cleanup.",
      nextPromptGuidance: "Regenerate with cleaner reward lighting and a stronger silhouette."
    });
    const second = store.saveJudgment({
      candidateId: candidate.id,
      decisionLabel: "needs_edit",
      humanReason: "The same human guidance still applies.",
      nextPromptGuidance: "Regenerate with cleaner reward lighting and a stronger silhouette."
    });

    expect(first.guidance).toMatchObject({ human_modified: 1 });
    expect(second.guidance).toMatchObject({ id: first.guidance?.id, human_modified: 1 });
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
