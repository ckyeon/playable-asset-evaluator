export type AssetType =
  | "card"
  | "coin_reward"
  | "button_cta"
  | "background_effect"
  | "character"
  | "other";

export type DecisionLabel = "good" | "needs_edit" | "reject";

export type SourceIntegrity = "complete" | "incomplete";

export type ConfidenceState = "normal" | "low_confidence";

export type Criterion =
  | "style_match"
  | "playable_readability"
  | "creative_appeal"
  | "production_usability";

export type EvaluationState = "draft" | "saved" | "failed";

export interface StyleProfile {
  id: string;
  name: string;
  description: string | null;
  style_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferenceAsset {
  id: string;
  style_profile_id: string;
  asset_type: AssetType;
  file_path: string;
  thumbnail_path: string | null;
  note: string | null;
  pinned: 0 | 1;
  created_at: string;
}

export interface EvaluationSession {
  id: string;
  style_profile_id: string;
  name: string;
  source_context: string | null;
  created_at: string;
}

export interface CandidateImage {
  id: string;
  session_id: string;
  file_path: string;
  thumbnail_path: string | null;
  generation_tool: string | null;
  prompt_text: string | null;
  prompt_missing: 0 | 1;
  source_integrity: SourceIntegrity;
  recovery_note: string | null;
  created_at: string;
}

export interface Evaluation {
  id: string;
  candidate_image_id: string;
  model_name: string;
  fit_score: number;
  decision_label: DecisionLabel;
  human_reason: string | null;
  ai_summary: string | null;
  raw_model_output_json: string | null;
  confidence_state: ConfidenceState;
  evaluation_state: EvaluationState;
  created_at: string;
}

export interface EvaluationCriterion {
  id: string;
  evaluation_id: string;
  criterion: Criterion;
  score: number;
  reason: string;
}

export interface PromptGuidance {
  id: string;
  style_profile_id: string;
  evaluation_id: string | null;
  guidance_text: string;
  confidence_state: ConfidenceState;
  copied_at: string | null;
  created_at: string;
}

export interface EvaluationDraft {
  evaluation: Evaluation;
  criteria: EvaluationCriterion[];
  next_prompt_guidance: string;
  weak_reference_set: boolean;
}
