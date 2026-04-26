import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { decisionLabelSchema } from "@/lib/model/evaluation-schema";
import { manualFitScore } from "@/lib/services/manual-fit-score";
import type {
  CandidateImage,
  ConfidenceState,
  DecisionLabel,
  Evaluation,
  EvaluationCriterion,
  GenerationContext,
  PromptGuidance
} from "@/lib/types/domain";

interface SaveJudgmentInput {
  candidateId: string;
  decisionLabel: DecisionLabel;
  humanReason: string;
  promptText?: string | null;
  promptMissing?: boolean;
  recoveryNote?: string | null;
  generationTool?: string | null;
  nextPromptGuidance?: string | null;
}

export class JudgmentStore {
  saveJudgment(input: SaveJudgmentInput): {
    evaluation: Evaluation;
    criteria: EvaluationCriterion[];
    guidance: PromptGuidance | null;
  } {
    const db = getDb();
    const decisionLabel = decisionLabelSchema.parse(input.decisionLabel);
    const humanReason = input.humanReason.trim();
    if (!humanReason) {
      throw new Error("Human reason is required before saving a judgment.");
    }

    const candidate = db
      .prepare("SELECT * FROM candidate_images WHERE id = ?")
      .get(input.candidateId) as CandidateImage | undefined;
    if (!candidate) {
      throw new Error("Candidate image not found.");
    }

    const context = db
      .prepare("SELECT * FROM generation_contexts WHERE id = ?")
      .get(candidate.generation_context_id) as GenerationContext | undefined;
    if (!context) {
      throw new Error("Generation context not found.");
    }

    const promptText = input.promptText?.trim() || candidate.prompt_text || null;
    const recoveryNote = input.recoveryNote?.trim() || candidate.recovery_note || null;
    const promptMissing = Boolean(input.promptMissing || !promptText);
    if (promptMissing && !recoveryNote) {
      throw new Error("Recovery note is required when the original prompt is missing.");
    }

    const confidenceState: ConfidenceState = promptMissing ? "low_confidence" : "normal";
    const sourceIntegrity = promptMissing ? "incomplete" : "complete";
    const evaluationId: string = randomUUID();
    let savedEvaluationId: string = evaluationId;
    let savedGuidanceId: string | null = null;

    const save = db.transaction(() => {
      db.prepare(
        `UPDATE candidate_images
         SET prompt_text = ?, prompt_missing = ?, source_integrity = ?, recovery_note = ?, generation_tool = COALESCE(?, generation_tool)
         WHERE id = ?`
      ).run(
        promptText,
        promptMissing ? 1 : 0,
        sourceIntegrity,
        recoveryNote,
        input.generationTool?.trim() || null,
        candidate.id
      );

      const draft = db
        .prepare(
          `SELECT * FROM evaluations
           WHERE candidate_image_id = ? AND evaluation_state = 'draft'
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(candidate.id) as Evaluation | undefined;
      const saved = draft
        ? undefined
        : (db
            .prepare(
              `SELECT * FROM evaluations
               WHERE candidate_image_id = ? AND evaluation_state = 'saved'
               ORDER BY created_at DESC
               LIMIT 1`
            )
            .get(candidate.id) as Evaluation | undefined);

      if (draft) {
        savedEvaluationId = draft.id;
        db.prepare(
          `UPDATE evaluations
           SET decision_label = ?, human_reason = ?, confidence_state = ?, evaluation_state = 'saved'
           WHERE id = ?`
        ).run(decisionLabel, humanReason, confidenceState, draft.id);
      } else if (saved) {
        savedEvaluationId = saved.id;
        db.prepare(
          `UPDATE evaluations
           SET decision_label = ?, human_reason = ?, confidence_state = ?
           WHERE id = ?`
        ).run(decisionLabel, humanReason, confidenceState, saved.id);
      } else {
        db.prepare(
          `INSERT INTO evaluations
            (id, candidate_image_id, model_name, fit_score, decision_label, human_reason, ai_summary, raw_model_output_json, confidence_state, evaluation_state, rubric_version)
           VALUES (?, ?, 'manual-judgment', ?, ?, ?, NULL, NULL, ?, 'saved', 'v2_generation_context')`
        ).run(evaluationId, candidate.id, manualFitScore(decisionLabel), decisionLabel, humanReason, confidenceState);
      }

      const guidanceText = input.nextPromptGuidance?.trim();
      if (guidanceText) {
        const existingGuidance = db
          .prepare(
            `SELECT id, guidance_text, human_modified
             FROM prompt_guidance
             WHERE evaluation_id = ?
             ORDER BY created_at DESC
             LIMIT 1`
          )
          .get(savedEvaluationId) as { id: string; guidance_text: string; human_modified: 0 | 1 } | undefined;

        if (existingGuidance) {
          savedGuidanceId = existingGuidance.id;
          const humanModified = existingGuidance.human_modified === 1 || existingGuidance.guidance_text !== guidanceText ? 1 : 0;
          db.prepare(
            `UPDATE prompt_guidance
             SET guidance_text = ?, confidence_state = ?, human_modified = ?
             WHERE id = ?`
          ).run(guidanceText, confidenceState, humanModified, existingGuidance.id);
        } else {
          savedGuidanceId = randomUUID();
          db.prepare(
            `INSERT INTO prompt_guidance
              (id, style_profile_id, evaluation_id, guidance_text, confidence_state, human_modified)
            VALUES (?, ?, ?, ?, ?, 1)`
          ).run(savedGuidanceId, context.style_profile_id, savedEvaluationId, guidanceText, confidenceState);
        }
      } else {
        db.prepare("DELETE FROM prompt_guidance WHERE evaluation_id = ?").run(savedEvaluationId);
      }

      db.prepare(
        `UPDATE generation_contexts
         SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(context.id);
      refreshStyleSummary(context.style_profile_id);
    });

    save();

    return {
      evaluation: db.prepare("SELECT * FROM evaluations WHERE id = ?").get(savedEvaluationId) as Evaluation,
      criteria: db
        .prepare("SELECT * FROM evaluation_criteria WHERE evaluation_id = ? ORDER BY criterion")
        .all(savedEvaluationId) as EvaluationCriterion[],
      guidance: savedGuidanceId
        ? (db.prepare("SELECT * FROM prompt_guidance WHERE id = ?").get(savedGuidanceId) as PromptGuidance)
        : null
    };
  }
}

function refreshStyleSummary(styleProfileId: string): void {
  const db = getDb();
  const guidance = db
    .prepare(
      `SELECT guidance_text, confidence_state
       FROM prompt_guidance
       WHERE style_profile_id = ?
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .all(styleProfileId) as Array<{ guidance_text: string; confidence_state: ConfidenceState }>;

  if (guidance.length === 0) {
    return;
  }

  const summary = guidance
    .map((item) => `${item.confidence_state === "low_confidence" ? "Low confidence: " : ""}${item.guidance_text}`)
    .join("\n");

  db.prepare(
    `UPDATE style_profiles
     SET style_summary = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(summary, styleProfileId);
}
