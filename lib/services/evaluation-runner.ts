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
  GenerationContext,
  GenerationContextAsset,
  ReferenceAsset,
  StyleProfile
} from "@/lib/types/domain";
import { computeContextConfidence } from "@/lib/services/generation-context-service";

interface EvaluationContext {
  profile: StyleProfile;
  generationContext: GenerationContext;
  candidate: CandidateImage;
  sourceAssets: GenerationContextAsset[];
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

  selectContextSourceAssets(context: GenerationContext, requestedReferenceIds: string[] = []): {
    sourceAssets: GenerationContextAsset[];
    weakReferenceSet: boolean;
  } {
    const db = getDb();
    let sourceAssets = db
      .prepare(
        `SELECT * FROM generation_context_assets
         WHERE generation_context_id = ?
         ORDER BY origin ASC, created_at DESC
         LIMIT 8`
      )
      .all(context.id) as GenerationContextAsset[];

    if (sourceAssets.length === 0 && requestedReferenceIds.length > 0) {
      const subset = this.selectReferenceSubset(context.style_profile_id, requestedReferenceIds);
      sourceAssets = subset.references.map(referenceToContextAsset(context.id));
    }

    if (sourceAssets.length === 0) {
      const subset = this.selectReferenceSubset(context.style_profile_id);
      sourceAssets = subset.references.map(referenceToContextAsset(context.id));
    }

    return {
      sourceAssets,
      weakReferenceSet: sourceAssets.length < 3
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

    const generationContext = db
      .prepare("SELECT * FROM generation_contexts WHERE id = ?")
      .get(candidate.generation_context_id) as GenerationContext | undefined;
    if (!generationContext) {
      throw new Error("Generation context not found.");
    }

    const profile = db
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(generationContext.style_profile_id) as StyleProfile | undefined;
    if (!profile) {
      throw new Error("Style profile not found.");
    }

    const subset = this.selectContextSourceAssets(generationContext, requestedReferenceIds);

    return {
      profile,
      generationContext,
      candidate,
      sourceAssets: subset.sourceAssets,
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
          (id, candidate_image_id, model_name, fit_score, decision_label, human_reason, ai_summary, raw_model_output_json, confidence_state, evaluation_state, rubric_version)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'draft', 'v2_generation_context')`
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
    const context = this.loadContext(candidateId, []);
    const confidence = computeContextConfidence(context.generationContext, context.sourceAssets);

    return {
      evaluation: db.prepare("SELECT * FROM evaluations WHERE id = ?").get(evaluationId) as Evaluation,
      criteria: db
        .prepare("SELECT * FROM evaluation_criteria WHERE evaluation_id = ? ORDER BY criterion")
        .all(evaluationId) as EvaluationCriterion[],
      next_prompt_guidance: parsed.next_prompt_guidance,
      weak_reference_set: weakReferenceSet,
      confidence_reasons: confidence.confidence_reasons
    };
  }

  private storeFailedEvaluation(candidateId: string, raw: unknown): Evaluation {
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO evaluations
        (id, candidate_image_id, model_name, fit_score, decision_label, human_reason, ai_summary, raw_model_output_json, confidence_state, evaluation_state, rubric_version)
       VALUES (?, ?, ?, 0, 'reject', NULL, ?, ?, 'low_confidence', 'failed', 'v2_generation_context')`
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
      context.sourceAssets.length > 0
        ? `${context.sourceAssets.length} context source assets`
        : "the currently empty context source set";

    return {
      fit_score: fitScore,
      criteria: [
        {
          criterion: "profile_fit",
          score: Math.max(40, fitScore - 2),
          reason: `Compare palette, lighting, and rendering weight against ${referenceLanguage}; keep the candidate closer to the accepted mobile-game look.`
        },
        {
          criterion: "source_asset_match",
          score: Math.max(40, fitScore + 3),
          reason: "Check whether the candidate matches the actual source assets used for this generation context, not only the profile-wide memory."
        },
        {
          criterion: "prompt_intent_match",
          score: Math.max(40, fitScore + 1),
          reason: "The candidate should satisfy the context prompt and brief instead of drifting into a generic asset variant."
        },
        {
          criterion: "production_usability",
          score: Math.max(40, fitScore - 4),
          reason: "Prefer clean silhouettes, separable layers, and crops that can be animated in the playable build."
        }
      ],
      ai_summary: promptMissing
        ? "Draft evaluation is low confidence because the original generation prompt is missing."
        : "Draft evaluation compares the candidate against the active generation context and source assets.",
      suggested_decision: decision,
      next_prompt_guidance: promptMissing
        ? "Recover the likely prompt intent first, then ask for a crisp mobile-game asset matching the Korean card casino remix references."
        : `Revise the next prompt toward ${context.generationContext.generation_goal || context.profile.name}: bright readable mobile-game rendering, clean silhouette, and reusable production-ready separation.`,
      confidence_state: confidence
    };
  }
}

function referenceToContextAsset(generationContextId: string) {
  return (reference: ReferenceAsset): GenerationContextAsset => ({
    id: reference.id,
    generation_context_id: generationContextId,
    reference_asset_id: reference.id,
    origin: "profile_reference",
    asset_type: reference.asset_type,
    file_path: reference.file_path,
    thumbnail_path: reference.thumbnail_path,
    snapshot_note: reference.note,
    created_at: reference.created_at
  });
}
