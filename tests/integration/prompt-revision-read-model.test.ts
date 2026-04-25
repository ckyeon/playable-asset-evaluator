import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { ExportBuilder } from "@/lib/services/export-builder";
import { loadProfileContextReadModel } from "@/lib/services/profile-context-read-model";
import { PromptRevisionService } from "@/lib/services/prompt-revision-service";
import { useTempDataDir } from "../helpers";

describe("prompt revision read model", () => {
  it("links candidates to revisions and computes effectiveness from saved evaluations", () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const service = new PromptRevisionService();
    const root = service.createRevision({
      generationContextId: generationContext.id,
      revisionLabel: "root",
      promptText: "root prompt"
    });
    const improved = service.createRevision({
      generationContextId: generationContext.id,
      parentPromptRevisionId: root.id,
      revisionLabel: "improved",
      promptText: "improved prompt"
    });
    const flat = service.createRevision({
      generationContextId: generationContext.id,
      parentPromptRevisionId: root.id,
      revisionLabel: "flat",
      promptText: "flat prompt"
    });
    const regressed = service.createRevision({
      generationContextId: generationContext.id,
      parentPromptRevisionId: root.id,
      revisionLabel: "regressed",
      promptText: "regressed prompt"
    });
    const unknown = service.createRevision({
      generationContextId: generationContext.id,
      parentPromptRevisionId: root.id,
      revisionLabel: "unknown",
      promptText: "unknown prompt"
    });
    const parentNoSaved = service.createRevision({
      generationContextId: generationContext.id,
      revisionLabel: "parent-no-saved",
      promptText: "parent without score"
    });
    const childParentNoSaved = service.createRevision({
      generationContextId: generationContext.id,
      parentPromptRevisionId: parentNoSaved.id,
      revisionLabel: "child-parent-no-saved",
      promptText: "child with score"
    });
    const brokenId = randomUUID();
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO prompt_revisions
        (id, generation_context_id, parent_prompt_revision_id, prompt_text, revision_label)
       VALUES (?, ?, ?, ?, ?)`
    ).run(brokenId, generationContext.id, "missing-parent", "broken prompt", "broken");
    db.pragma("foreign_keys = ON");

    const rootEvaluationId = insertCandidateEvaluation(generationContext.id, root.id, "candidate-root", 64);
    const sourceGuidanceId = randomUUID();
    db.prepare(
      `INSERT INTO prompt_guidance
        (id, style_profile_id, evaluation_id, guidance_text, confidence_state)
       VALUES (?, ?, ?, ?, 'normal')`
    ).run(sourceGuidanceId, profile.id, rootEvaluationId, "Use a cleaner silhouette and keep the same character.");
    const sourced = service.createRevision({
      generationContextId: generationContext.id,
      parentPromptRevisionId: root.id,
      sourceGuidanceId,
      revisionLabel: "sourced",
      promptText: "sourced prompt"
    });
    insertCandidateEvaluation(generationContext.id, improved.id, "candidate-improved", 86);
    insertCandidateEvaluation(generationContext.id, flat.id, "candidate-flat", 66);
    insertCandidateEvaluation(generationContext.id, regressed.id, "candidate-regressed", 28);
    insertCandidateEvaluation(generationContext.id, childParentNoSaved.id, "candidate-parent-no-saved", 86);

    const model = loadProfileContextReadModel(profile.id);
    const context = model.contexts.find((item) => item.context.id === generationContext.id)!;
    const revisions = new Map(context.promptRevisions.map((revision) => [revision.id, revision]));

    expect(revisions.get(root.id)).toMatchObject({
      candidate_count: 1,
      effectiveness: "unknown",
      effectiveness_reason: "root_revision"
    });
    expect(revisions.get(improved.id)).toMatchObject({ effectiveness: "improved", effectiveness_reason: "improved" });
    expect(revisions.get(flat.id)).toMatchObject({ effectiveness: "flat", effectiveness_reason: "flat" });
    expect(revisions.get(regressed.id)).toMatchObject({ effectiveness: "regressed", effectiveness_reason: "regressed" });
    expect(revisions.get(unknown.id)).toMatchObject({
      effectiveness: "unknown",
      effectiveness_reason: "no_saved_evaluation"
    });
    expect(revisions.get(childParentNoSaved.id)).toMatchObject({
      effectiveness: "unknown",
      effectiveness_reason: "parent_no_saved_evaluation"
    });
    expect(revisions.get(sourced.id)?.sourceGuidance).toEqual(
      expect.objectContaining({
        id: sourceGuidanceId,
        guidance_text: "Use a cleaner silhouette and keep the same character."
      })
    );
    expect(revisions.get(brokenId)).toMatchObject({
      effectiveness: "unknown",
      effectiveness_reason: "broken_lineage"
    });
    expect(context.candidates.find((item) => item.candidate.id === "candidate-improved")?.promptRevision?.id).toBe(
      improved.id
    );

    const exported = new ExportBuilder().buildJson(profile.id) as {
      contexts: Array<{
        prompt_revisions: Array<{ id: string; effectiveness: string; sourceGuidance: { id: string } | null }>;
        candidates: Array<{ id: string; prompt_revision_id: string | null; prompt_revision: { id: string } | null }>;
      }>;
    };
    expect(exported.contexts[0].prompt_revisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: improved.id, effectiveness: "improved" }),
        expect.objectContaining({ id: sourced.id, sourceGuidance: expect.objectContaining({ id: sourceGuidanceId }) })
      ])
    );
    expect(exported.contexts[0].candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "candidate-improved",
          prompt_revision_id: improved.id,
          prompt_revision: expect.objectContaining({ id: improved.id })
        })
      ])
    );

    const markdown = new ExportBuilder().buildMarkdown(profile.id);
    expect(markdown).toContain("### Prompt Revisions");
    expect(markdown).toContain(`- Prompt revision: ${improved.id}`);
    expect(markdown).toContain(`- Source guidance: ${sourceGuidanceId}`);
  });
});

function insertCandidateEvaluation(
  generationContextId: string,
  promptRevisionId: string,
  candidateId: string,
  fitScore: number
): string {
  const db = getDb();
  const evaluationId = randomUUID();
  db.prepare(
    `INSERT INTO candidate_images
      (id, generation_context_id, prompt_revision_id, file_path, prompt_text, prompt_missing, source_integrity)
     VALUES (?, ?, ?, ?, ?, 0, 'complete')`
  ).run(candidateId, generationContextId, promptRevisionId, `assets/${candidateId}.png`, `${candidateId} prompt`);
  db.prepare(
    `INSERT INTO evaluations
      (id, candidate_image_id, model_name, fit_score, decision_label, human_reason, ai_summary, raw_model_output_json, confidence_state, evaluation_state, rubric_version)
     VALUES (?, ?, 'manual-judgment', ?, 'needs_edit', 'reason', NULL, NULL, 'normal', 'saved', 'v2_generation_context')`
  ).run(evaluationId, candidateId, fitScore);
  return evaluationId;
}
