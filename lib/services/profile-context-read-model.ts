import { getDb } from "@/lib/db/client";
import { computeContextConfidence, type ContextConfidence } from "@/lib/services/generation-context-service";
import type {
  CandidateImage,
  Evaluation,
  EvaluationCriterion,
  GenerationContext,
  GenerationContextAsset,
  PromptGuidance,
  PromptRevision,
  ReferenceAsset,
  StyleProfile
} from "@/lib/types/domain";

export type PromptRevisionEffectiveness = "improved" | "flat" | "regressed" | "unknown";

export type PromptRevisionEffectivenessReason =
  | "improved"
  | "flat"
  | "regressed"
  | "root_revision"
  | "no_saved_evaluation"
  | "parent_no_saved_evaluation"
  | "broken_lineage";

export interface PromptRevisionReadModel extends PromptRevision {
  candidate_ids: string[];
  candidate_count: number;
  effectiveness: PromptRevisionEffectiveness;
  effectiveness_reason: PromptRevisionEffectivenessReason;
}

type EvaluationReadModel = Evaluation & { criteria: EvaluationCriterion[]; prompt_guidance: PromptGuidance[] };

export interface CandidateReadModel {
  candidate: CandidateImage;
  promptRevision: PromptRevisionReadModel | null;
  evaluations: EvaluationReadModel[];
}

export interface GenerationContextReadModel extends ContextConfidence {
  context: GenerationContext;
  sourceAssets: GenerationContextAsset[];
  promptRevisions: PromptRevisionReadModel[];
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
  const promptRevisions = contextIds.length
    ? (db
        .prepare(
          `SELECT * FROM prompt_revisions
           WHERE generation_context_id IN (${placeholders(contextIds)})
           ORDER BY created_at ASC, id ASC`
        )
        .all(...contextIds) as PromptRevision[])
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

  const assetsByContext = groupBy(sourceAssets, (asset) => asset.generation_context_id);
  const revisionsByContext = groupBy(promptRevisions, (revision) => revision.generation_context_id);
  const candidatesByContext = groupBy(candidates, (candidate) => candidate.generation_context_id);
  const evaluationsByCandidate = groupBy(evaluations, (evaluation) => evaluation.candidate_image_id);
  const criteriaByEvaluation = groupBy(criteria, (criterion) => criterion.evaluation_id);
  const guidanceByEvaluation = groupBy(guidance, (item) => item.evaluation_id || "");
  const candidateIdsByRevision = groupCandidateIdsByRevision(candidates);
  const scoreByRevision = bestSavedScoreByRevision(candidates, evaluations);
  const revisionModelsById = new Map<string, PromptRevisionReadModel>();
  for (const revision of promptRevisions) {
    revisionModelsById.set(revision.id, toRevisionReadModel(revision, promptRevisions, candidateIdsByRevision, scoreByRevision));
  }

  return {
    profile,
    referenceAssets,
    contexts: contexts.map((context) => {
      const contextAssets = assetsByContext.get(context.id) || [];
      const contextCandidates = candidatesByContext.get(context.id) || [];
      const contextRevisions = (revisionsByContext.get(context.id) || []).map((revision) => revisionModelsById.get(revision.id)!);
      const candidateModels = contextCandidates.map((candidate) => ({
        candidate,
        promptRevision: candidate.prompt_revision_id ? revisionModelsById.get(candidate.prompt_revision_id) || null : null,
        evaluations: (evaluationsByCandidate.get(candidate.id) || []).map((evaluation) => ({
          ...evaluation,
          criteria: criteriaByEvaluation.get(evaluation.id) || [],
          prompt_guidance: guidanceByEvaluation.get(evaluation.id) || []
        }))
      }));
      const latestEvaluation = candidateModels.flatMap((candidate) => candidate.evaluations)[0] || null;
      const confidence = computeContextConfidence(context, contextAssets, latestEvaluation);

      return {
        context,
        sourceAssets: contextAssets,
        promptRevisions: contextRevisions,
        candidates: candidateModels,
        ...confidence
      };
    })
  };
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(",");
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) {
      continue;
    }
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }
  return grouped;
}

function groupCandidateIdsByRevision(candidates: CandidateImage[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const candidate of candidates) {
    if (!candidate.prompt_revision_id) {
      continue;
    }
    grouped.set(candidate.prompt_revision_id, [...(grouped.get(candidate.prompt_revision_id) || []), candidate.id]);
  }
  return grouped;
}

function bestSavedScoreByRevision(candidates: CandidateImage[], evaluations: Evaluation[]): Map<string, number> {
  const revisionIdByCandidateId = new Map(
    candidates
      .filter((candidate) => candidate.prompt_revision_id)
      .map((candidate) => [candidate.id, candidate.prompt_revision_id as string])
  );
  const scores = new Map<string, number>();

  for (const evaluation of evaluations) {
    if (evaluation.evaluation_state !== "saved") {
      continue;
    }
    const revisionId = revisionIdByCandidateId.get(evaluation.candidate_image_id);
    if (!revisionId) {
      continue;
    }
    scores.set(revisionId, Math.max(scores.get(revisionId) ?? Number.NEGATIVE_INFINITY, evaluation.fit_score));
  }

  return scores;
}

function toRevisionReadModel(
  revision: PromptRevision,
  allRevisions: PromptRevision[],
  candidateIdsByRevision: Map<string, string[]>,
  scoreByRevision: Map<string, number>
): PromptRevisionReadModel {
  const effectiveness = computeEffectiveness(revision, allRevisions, scoreByRevision);
  const candidateIds = candidateIdsByRevision.get(revision.id) || [];
  return {
    ...revision,
    candidate_ids: candidateIds,
    candidate_count: candidateIds.length,
    effectiveness: effectiveness.effectiveness,
    effectiveness_reason: effectiveness.reason
  };
}

function computeEffectiveness(
  revision: PromptRevision,
  allRevisions: PromptRevision[],
  scoreByRevision: Map<string, number>
): { effectiveness: PromptRevisionEffectiveness; reason: PromptRevisionEffectivenessReason } {
  if (!revision.parent_prompt_revision_id) {
    return { effectiveness: "unknown", reason: "root_revision" };
  }

  const parent = allRevisions.find((item) => item.id === revision.parent_prompt_revision_id);
  if (!parent) {
    return { effectiveness: "unknown", reason: "broken_lineage" };
  }

  const score = scoreByRevision.get(revision.id);
  if (score === undefined) {
    return { effectiveness: "unknown", reason: "no_saved_evaluation" };
  }

  const parentScore = scoreByRevision.get(parent.id);
  if (parentScore === undefined) {
    return { effectiveness: "unknown", reason: "parent_no_saved_evaluation" };
  }

  const delta = score - parentScore;
  if (delta >= 5) {
    return { effectiveness: "improved", reason: "improved" };
  }
  if (delta <= -5) {
    return { effectiveness: "regressed", reason: "regressed" };
  }
  return { effectiveness: "flat", reason: "flat" };
}
