import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { parseModelEvaluation, type ModelEvaluationOutput } from "@/lib/model/evaluation-schema";
import type {
  CandidateImage,
  ConfidenceState,
  DecisionLabel,
  Evaluation,
  EvaluationCriterion,
  EvaluationDraft,
  EvaluationSession,
  ReferenceAsset,
  StyleProfile
} from "@/lib/types/domain";

interface EvaluationContext {
  profile: StyleProfile;
  session: EvaluationSession;
  candidate: CandidateImage;
  references: ReferenceAsset[];
  weakReferenceSet: boolean;
}

interface ModelAdapter {
  evaluate(context: EvaluationContext): Promise<unknown>;
}

export class EvaluationRunner {
  constructor(private readonly adapter: ModelAdapter = new MockEvaluationAdapter()) {}

  selectReferenceSubset(styleProfileId: string, requestedReferenceIds: string[] = []): {
    references: ReferenceAsset[];
    weakReferenceSet: boolean;
  } {
    const db = getDb();

    let references: ReferenceAsset[] = [];
    if (requestedReferenceIds.length > 0) {
      const placeholders = requestedReferenceIds.map(() => "?").join(",");
      references = db
        .prepare(
          `SELECT * FROM reference_assets
           WHERE style_profile_id = ? AND id IN (${placeholders})
           ORDER BY pinned DESC, created_at DESC
           LIMIT 8`
        )
        .all(styleProfileId, ...requestedReferenceIds) as ReferenceAsset[];
    }

    if (references.length === 0) {
      references = db
        .prepare(
          `SELECT * FROM reference_assets
           WHERE style_profile_id = ?
           ORDER BY pinned DESC, asset_type ASC, created_at DESC
           LIMIT 8`
        )
        .all(styleProfileId) as ReferenceAsset[];
    }

    return {
      references,
      weakReferenceSet: references.length < 3
    };
  }

  async evaluateCandidate(candidateId: string, requestedReferenceIds: string[] = []): Promise<EvaluationDraft> {
    const context = this.loadContext(candidateId, requestedReferenceIds);
    const raw = await this.adapter.evaluate(context);

    let parsed: ModelEvaluationOutput;
    try {
      parsed = parseModelEvaluation(raw);
    } catch (error) {
      const failed = this.storeFailedEvaluation(candidateId, raw);
      throw Object.assign(new Error("Model returned invalid evaluation JSON."), {
        cause: error,
        failedEvaluation: failed
      });
    }

    return this.storeDraftEvaluation(candidateId, context.profile.id, parsed, raw, context.weakReferenceSet);
  }

  private loadContext(candidateId: string, requestedReferenceIds: string[]): EvaluationContext {
    const db = getDb();
    const candidate = db
      .prepare("SELECT * FROM candidate_images WHERE id = ?")
      .get(candidateId) as CandidateImage | undefined;
    if (!candidate) {
      throw new Error("Candidate image not found.");
    }

    const session = db
      .prepare("SELECT * FROM evaluation_sessions WHERE id = ?")
      .get(candidate.session_id) as EvaluationSession | undefined;
    if (!session) {
      throw new Error("Evaluation session not found.");
    }

    const profile = db
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(session.style_profile_id) as StyleProfile | undefined;
    if (!profile) {
      throw new Error("Style profile not found.");
    }

    const subset = this.selectReferenceSubset(profile.id, requestedReferenceIds);

    return {
      profile,
      session,
      candidate,
      references: subset.references,
      weakReferenceSet: subset.weakReferenceSet
    };
  }

  private storeDraftEvaluation(
    candidateId: string,
    styleProfileId: string,
    parsed: ModelEvaluationOutput,
    raw: unknown,
    weakReferenceSet: boolean
  ): EvaluationDraft {
    const db = getDb();
    const evaluationId = randomUUID();

    const insert = db.transaction(() => {
      db.prepare(
        `DELETE FROM evaluation_criteria
         WHERE evaluation_id IN (
           SELECT id FROM evaluations
           WHERE candidate_image_id = ? AND evaluation_state = 'draft'
         )`
      ).run(candidateId);
      db.prepare(
        `DELETE FROM prompt_guidance
         WHERE evaluation_id IN (
           SELECT id FROM evaluations
           WHERE candidate_image_id = ? AND evaluation_state = 'draft'
         )`
      ).run(candidateId);
      db.prepare("DELETE FROM evaluations WHERE candidate_image_id = ? AND evaluation_state = 'draft'").run(
        candidateId
      );

      db.prepare(
        `INSERT INTO evaluations
          (id, candidate_image_id, model_name, fit_score, decision_label, human_reason, ai_summary, raw_model_output_json, confidence_state, evaluation_state)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'draft')`
      ).run(
        evaluationId,
        candidateId,
        process.env.EVALUATION_MODEL || "mock-evaluator-v1",
        parsed.fit_score,
        parsed.suggested_decision,
        parsed.ai_summary,
        JSON.stringify(raw),
        parsed.confidence_state
      );

      for (const criterion of parsed.criteria) {
        db.prepare(
          `INSERT INTO evaluation_criteria (id, evaluation_id, criterion, score, reason)
           VALUES (?, ?, ?, ?, ?)`
        ).run(randomUUID(), evaluationId, criterion.criterion, criterion.score, criterion.reason);
      }

      db.prepare(
        `INSERT INTO prompt_guidance
          (id, style_profile_id, evaluation_id, guidance_text, confidence_state)
         VALUES (?, ?, ?, ?, ?)`
      ).run(randomUUID(), styleProfileId, evaluationId, parsed.next_prompt_guidance, parsed.confidence_state);
    });

    insert();

    return {
      evaluation: db.prepare("SELECT * FROM evaluations WHERE id = ?").get(evaluationId) as Evaluation,
      criteria: db
        .prepare("SELECT * FROM evaluation_criteria WHERE evaluation_id = ? ORDER BY criterion")
        .all(evaluationId) as EvaluationCriterion[],
      next_prompt_guidance: parsed.next_prompt_guidance,
      weak_reference_set: weakReferenceSet
    };
  }

  private storeFailedEvaluation(candidateId: string, raw: unknown): Evaluation {
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO evaluations
        (id, candidate_image_id, model_name, fit_score, decision_label, human_reason, ai_summary, raw_model_output_json, confidence_state, evaluation_state)
       VALUES (?, ?, ?, 0, 'reject', NULL, ?, ?, 'low_confidence', 'failed')`
    ).run(id, candidateId, process.env.EVALUATION_MODEL || "mock-evaluator-v1", "Invalid model JSON.", JSON.stringify(raw));

    return db.prepare("SELECT * FROM evaluations WHERE id = ?").get(id) as Evaluation;
  }
}

class MockEvaluationAdapter implements ModelAdapter {
  async evaluate(context: EvaluationContext): Promise<ModelEvaluationOutput> {
    const promptMissing = context.candidate.prompt_missing === 1 || !context.candidate.prompt_text;
    const confidence: ConfidenceState = promptMissing ? "low_confidence" : "normal";
    const weakPenalty = context.weakReferenceSet ? 10 : 0;
    const promptPenalty = promptMissing ? 8 : 0;
    const fitScore = Math.max(42, 78 - weakPenalty - promptPenalty);
    const decision: DecisionLabel = fitScore >= 82 ? "good" : fitScore >= 55 ? "needs_edit" : "reject";
    const referenceLanguage =
      context.references.length > 0
        ? `${context.references.length} selected reference assets`
        : "the currently empty reference set";

    return {
      fit_score: fitScore,
      criteria: [
        {
          criterion: "style_match",
          score: Math.max(40, fitScore - 2),
          reason: `Compare palette, lighting, and rendering weight against ${referenceLanguage}; keep the candidate closer to the accepted mobile-game look.`
        },
        {
          criterion: "playable_readability",
          score: Math.max(40, fitScore + 3),
          reason: "Check whether the main shape reads quickly on a small phone screen and avoids CTA or reward clutter."
        },
        {
          criterion: "creative_appeal",
          score: Math.max(40, fitScore + 1),
          reason: "The candidate should feel lively and rewarding without drifting into unrelated casino realism."
        },
        {
          criterion: "production_usability",
          score: Math.max(40, fitScore - 4),
          reason: "Prefer clean silhouettes, separable layers, and crops that can be animated in the playable build."
        }
      ],
      ai_summary: promptMissing
        ? "Draft evaluation is low confidence because the original generation prompt is missing."
        : "Draft evaluation compares the candidate against the active style profile and reference subset.",
      suggested_decision: decision,
      next_prompt_guidance: promptMissing
        ? "Recover the likely prompt intent first, then ask for a crisp mobile-game asset matching the Korean card casino remix references."
        : `Revise the next prompt toward ${context.profile.name}: bright readable mobile-game rendering, clean silhouette, and restrained slot-machine reward energy.`,
      confidence_state: confidence
    };
  }
}
