import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { parseModelEvaluation, type ModelEvaluationOutput } from "@/lib/model/evaluation-schema";
import type {
  CandidateImage,
  Evaluation,
  EvaluationCriterion,
  EvaluationDraft,
  GenerationContext,
  GenerationContextAsset,
  ReferenceAsset,
  StyleProfile
} from "@/lib/types/domain";
import { computeContextConfidence } from "@/lib/services/generation-context-service";
import {
  createModelAdapterFromEnv,
  EvaluationAdapterError,
  referenceToContextAsset,
  resolveEvaluationRunnerConfig,
  type EvaluationContext,
  type ModelAdapter
} from "@/lib/services/evaluation-adapters";

const activeCandidateEvaluations = new Set<string>();

export class EvaluationRunner {
  constructor(
    private readonly adapter: ModelAdapter = createModelAdapterFromEnv(),
    private readonly modelName: string = resolveEvaluationRunnerConfig().modelName
  ) {}

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
    if (activeCandidateEvaluations.has(candidateId)) {
      throw new Error("Evaluation is already running for this candidate. Wait for it to finish before retrying.");
    }

    activeCandidateEvaluations.add(candidateId);
    try {
      const raw = await this.evaluateWithFailedPersistence(candidateId, context);

      let parsed: ModelEvaluationOutput;
      try {
        parsed = parseModelEvaluation(raw);
      } catch (error) {
        const failed = this.storeFailedEvaluation(candidateId, raw, "Model returned invalid evaluation JSON.");
        throw Object.assign(new Error("Model returned invalid evaluation JSON."), {
          cause: error,
          failedEvaluation: failed
        });
      }

      return this.storeDraftEvaluation(candidateId, context.profile.id, parsed, raw, context.weakReferenceSet);
    } finally {
      activeCandidateEvaluations.delete(candidateId);
    }
  }

  private async evaluateWithFailedPersistence(candidateId: string, context: EvaluationContext): Promise<unknown> {
    try {
      return await this.adapter.evaluate(context);
    } catch (error) {
      const rawOutput = rawOutputFromAdapterError(error);
      const message = error instanceof Error ? error.message : "Evaluation failed.";
      const failed = this.storeFailedEvaluation(candidateId, rawOutput, message);
      throw Object.assign(new Error(message), {
        cause: error,
        failedEvaluation: failed
      });
    }
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
        this.modelName,
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
          (id, style_profile_id, evaluation_id, guidance_text, confidence_state, human_modified)
         VALUES (?, ?, ?, ?, ?, 0)`
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

  private storeFailedEvaluation(candidateId: string, raw: unknown, summary: string): Evaluation {
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO evaluations
        (id, candidate_image_id, model_name, fit_score, decision_label, human_reason, ai_summary, raw_model_output_json, confidence_state, evaluation_state, rubric_version)
       VALUES (?, ?, ?, 0, 'reject', NULL, ?, ?, 'low_confidence', 'failed', 'v2_generation_context')`
    ).run(id, candidateId, this.modelName, summary, JSON.stringify(raw));

    return db.prepare("SELECT * FROM evaluations WHERE id = ?").get(id) as Evaluation;
  }
}

function rawOutputFromAdapterError(error: unknown): unknown {
  if (error instanceof EvaluationAdapterError) {
    return error.rawOutput;
  }
  return {
    error: error instanceof Error ? error.message : "Evaluation failed."
  };
}
