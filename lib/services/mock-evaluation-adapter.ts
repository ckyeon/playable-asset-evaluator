import type { ModelEvaluationOutput } from "@/lib/model/evaluation-schema";
import type { EvaluationContext, ModelAdapter } from "@/lib/services/evaluation-adapters";
import type { ConfidenceState, DecisionLabel } from "@/lib/types/domain";

export class MockEvaluationAdapter implements ModelAdapter {
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
      target_use_decision: decision,
      asset_quality_decision: decision,
      next_prompt_guidance: promptMissing
        ? "Recover the likely prompt intent first, then ask for a crisp mobile-game asset matching the Korean card casino remix references."
        : `Revise the next prompt toward ${context.generationContext.generation_goal || context.profile.name}: bright readable mobile-game rendering, clean silhouette, and reusable production-ready separation.`,
      confidence_state: confidence
    };
  }
}
