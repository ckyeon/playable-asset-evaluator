import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { JudgmentStore } from "@/lib/services/judgment-store";
import { AssetStorage } from "@/lib/services/asset-storage";
import { createImageFile, useTempDataDir } from "../helpers";

describe("JudgmentStore", () => {
  it("requires a human reason before saving", async () => {
    useTempDataDir();
    const db = getDb();
    const session = db.prepare("SELECT id FROM evaluation_sessions LIMIT 1").get() as { id: string };
    const candidate = await new AssetStorage().saveCandidateImage({
      sessionId: session.id,
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
    const session = db.prepare("SELECT id FROM evaluation_sessions LIMIT 1").get() as { id: string };
    const candidate = await new AssetStorage().saveCandidateImage({
      sessionId: session.id,
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
});
