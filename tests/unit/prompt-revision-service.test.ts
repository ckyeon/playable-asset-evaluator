import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { GenerationContextService } from "@/lib/services/generation-context-service";
import { PromptRevisionService } from "@/lib/services/prompt-revision-service";
import { useTempDataDir } from "../helpers";

describe("PromptRevisionService", () => {
  it("creates root and child prompt revisions with normalized parameters", () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const service = new PromptRevisionService();

    const root = service.createRevision({
      generationContextId: generationContext.id,
      promptText: "  bright reward icon  ",
      revisionLabel: "  v1  ",
      revisionNote: "  first pass  ",
      negativePrompt: "  blurry  ",
      parametersJson: '{ "seed": 12, "steps": 20 }'
    });
    const child = service.createRevision({
      generationContextId: generationContext.id,
      parentPromptRevisionId: root.id,
      promptText: "brighter reward icon"
    });

    expect(root).toMatchObject({
      generation_context_id: generationContext.id,
      parent_prompt_revision_id: null,
      revision_label: "v1",
      revision_note: "first pass",
      prompt_text: "bright reward icon",
      negative_prompt: "blurry",
      parameters_json: '{"seed":12,"steps":20}'
    });
    expect(child.parent_prompt_revision_id).toBe(root.id);
  });

  it("rejects parent revisions from another generation context", () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const firstContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const secondContext = new GenerationContextService().createContext({
      styleProfileId: profile.id,
      name: "Second context"
    });
    const service = new PromptRevisionService();
    const parent = service.createRevision({
      generationContextId: firstContext.id,
      promptText: "first context prompt"
    });

    expect(() =>
      service.createRevision({
        generationContextId: secondContext.id,
        parentPromptRevisionId: parent.id,
        promptText: "second context prompt"
      })
    ).toThrow(/Parent prompt revision does not belong/);
  });

  it("validates source guidance before linking it", () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const firstContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const secondContext = new GenerationContextService().createContext({
      styleProfileId: profile.id,
      name: "Second context"
    });
    const guidanceId = insertSavedGuidance(firstContext.id, profile.id);
    const service = new PromptRevisionService();

    expect(() =>
      service.createRevision({
        generationContextId: firstContext.id,
        sourceGuidanceId: "missing-guidance",
        promptText: "guided prompt"
      })
    ).toThrow(/Source guidance not found/);
    expect(() =>
      service.createRevision({
        generationContextId: secondContext.id,
        sourceGuidanceId: guidanceId,
        promptText: "guided prompt"
      })
    ).toThrow(/Source guidance does not belong to this generation context/);
  });

  it("rejects oversized fields and invalid parameters JSON", () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const service = new PromptRevisionService();

    expect(() =>
      service.createRevision({
        generationContextId: generationContext.id,
        promptText: "x".repeat(8001)
      })
    ).toThrow(/Prompt text/);
    expect(() =>
      service.createRevision({
        generationContextId: generationContext.id,
        promptText: "valid prompt",
        revisionLabel: "x".repeat(121)
      })
    ).toThrow(/Revision label/);
    expect(() =>
      service.createRevision({
        generationContextId: generationContext.id,
        promptText: "valid prompt",
        parametersJson: "not json"
      })
    ).toThrow(/valid JSON/);
    expect(() =>
      service.createRevision({
        generationContextId: generationContext.id,
        promptText: "valid prompt",
        parametersJson: "[]"
      })
    ).toThrow(/plain object/);
    expect(() =>
      service.createRevision({
        generationContextId: generationContext.id,
        promptText: "valid prompt",
        parametersJson: JSON.stringify({ value: "x".repeat(8192) })
      })
    ).toThrow(/8KB/);
  });

  it("resolves candidate upload revisions", () => {
    useTempDataDir();
    const db = getDb();
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const service = new PromptRevisionService();
    const existing = service.createRevision({
      generationContextId: generationContext.id,
      promptText: "existing prompt"
    });

    expect(
      service.resolveForCandidateUpload({
        generationContextId: generationContext.id,
        promptRevisionId: existing.id,
        promptText: "ignored upload prompt"
      })
    ).toEqual({ promptRevisionId: existing.id, promptText: "existing prompt" });

    const created = service.resolveForCandidateUpload({
      generationContextId: generationContext.id,
      promptText: "new upload prompt"
    });
    expect(created.promptRevisionId).toBeTruthy();
    expect(created.promptText).toBe("new upload prompt");
    expect(db.prepare("SELECT prompt_text FROM prompt_revisions WHERE id = ?").get(created.promptRevisionId)).toEqual({
      prompt_text: "new upload prompt"
    });

    expect(
      service.resolveForCandidateUpload({
        generationContextId: generationContext.id,
        promptMissing: true
      })
    ).toEqual({ promptRevisionId: null, promptText: null });
  });
});

function insertSavedGuidance(generationContextId: string, styleProfileId: string): string {
  const db = getDb();
  const candidateId = randomUUID();
  const evaluationId = randomUUID();
  const guidanceId = randomUUID();

  db.prepare(
    `INSERT INTO candidate_images
      (id, generation_context_id, file_path, prompt_text, prompt_missing, source_integrity)
     VALUES (?, ?, ?, ?, 0, 'complete')`
  ).run(candidateId, generationContextId, "assets/candidate.png", "source prompt");
  db.prepare(
    `INSERT INTO evaluations
      (id, candidate_image_id, model_name, fit_score, decision_label, human_reason, ai_summary, raw_model_output_json, confidence_state, evaluation_state, rubric_version)
     VALUES (?, ?, 'manual-judgment', 80, 'needs_edit', 'reason', NULL, NULL, 'normal', 'saved', 'v2_generation_context')`
  ).run(evaluationId, candidateId);
  db.prepare(
    `INSERT INTO prompt_guidance
      (id, style_profile_id, evaluation_id, guidance_text, confidence_state)
     VALUES (?, ?, ?, 'try a brighter silhouette', 'normal')`
  ).run(guidanceId, styleProfileId, evaluationId);

  return guidanceId;
}
