import { getDb } from "@/lib/db/client";
import { computeContextConfidence, type ContextConfidence } from "@/lib/services/generation-context-service";
import type {
  CandidateImage,
  Evaluation,
  EvaluationCriterion,
  GenerationContext,
  GenerationContextAsset,
  PromptGuidance,
  ReferenceAsset,
  StyleProfile
} from "@/lib/types/domain";

export interface CandidateReadModel {
  candidate: CandidateImage;
  evaluations: Array<Evaluation & { criteria: EvaluationCriterion[]; prompt_guidance: PromptGuidance[] }>;
}

export interface GenerationContextReadModel extends ContextConfidence {
  context: GenerationContext;
  sourceAssets: GenerationContextAsset[];
  candidates: CandidateReadModel[];
}

export interface ProfileContextReadModel {
  profile: StyleProfile;
  referenceAssets: ReferenceAsset[];
  contexts: GenerationContextReadModel[];
}

export function loadProfileContextReadModel(styleProfileId: string): ProfileContextReadModel {
  const db = getDb();
  const profile = db.prepare("SELECT * FROM style_profiles WHERE id = ?").get(styleProfileId) as
    | StyleProfile
    | undefined;
  if (!profile) {
    throw new Error("Style profile not found.");
  }

  const referenceAssets = db
    .prepare("SELECT * FROM reference_assets WHERE style_profile_id = ? ORDER BY pinned DESC, created_at DESC")
    .all(styleProfileId) as ReferenceAsset[];
  const contexts = db
    .prepare("SELECT * FROM generation_contexts WHERE style_profile_id = ? ORDER BY updated_at DESC, created_at DESC")
    .all(styleProfileId) as GenerationContext[];
  const contextIds = contexts.map((context) => context.id);
  const sourceAssets = contextIds.length
    ? (db
        .prepare(
          `SELECT * FROM generation_context_assets
           WHERE generation_context_id IN (${placeholders(contextIds)})
           ORDER BY created_at DESC`
        )
        .all(...contextIds) as GenerationContextAsset[])
    : [];
  const candidates = contextIds.length
    ? (db
        .prepare(
          `SELECT * FROM candidate_images
           WHERE generation_context_id IN (${placeholders(contextIds)})
           ORDER BY created_at DESC`
        )
        .all(...contextIds) as CandidateImage[])
    : [];
  const candidateIds = candidates.map((candidate) => candidate.id);
  const evaluations = candidateIds.length
    ? (db
        .prepare(
          `SELECT * FROM evaluations
           WHERE candidate_image_id IN (${placeholders(candidateIds)})
           ORDER BY created_at DESC`
        )
        .all(...candidateIds) as Evaluation[])
    : [];
  const evaluationIds = evaluations.map((evaluation) => evaluation.id);
  const criteria = evaluationIds.length
    ? (db
        .prepare(
          `SELECT * FROM evaluation_criteria
           WHERE evaluation_id IN (${placeholders(evaluationIds)})
           ORDER BY criterion`
        )
        .all(...evaluationIds) as EvaluationCriterion[])
    : [];
  const guidance = evaluationIds.length
    ? (db
        .prepare(
          `SELECT * FROM prompt_guidance
           WHERE evaluation_id IN (${placeholders(evaluationIds)})
           ORDER BY created_at DESC`
        )
        .all(...evaluationIds) as PromptGuidance[])
    : [];

  return {
    profile,
    referenceAssets,
    contexts: contexts.map((context) => {
      const contextAssets = sourceAssets.filter((asset) => asset.generation_context_id === context.id);
      const contextCandidates = candidates.filter((candidate) => candidate.generation_context_id === context.id);
      const candidateModels = contextCandidates.map((candidate) => ({
        candidate,
        evaluations: evaluations
          .filter((evaluation) => evaluation.candidate_image_id === candidate.id)
          .map((evaluation) => ({
            ...evaluation,
            criteria: criteria.filter((criterion) => criterion.evaluation_id === evaluation.id),
            prompt_guidance: guidance.filter((item) => item.evaluation_id === evaluation.id)
          }))
      }));
      const latestEvaluation = candidateModels.flatMap((candidate) => candidate.evaluations)[0] || null;
      const confidence = computeContextConfidence(context, contextAssets, latestEvaluation);

      return {
        context,
        sourceAssets: contextAssets,
        candidates: candidateModels,
        ...confidence
      };
    })
  };
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(",");
}
