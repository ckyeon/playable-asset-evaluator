import type {
  ALL_CRITERIA,
  ASSET_TYPES,
  CONFIDENCE_REASON_CODES,
  CONFIDENCE_STATES,
  CONTEXT_ASSET_ORIGINS,
  DECISION_LABELS,
  EVALUATION_STATES,
  RUBRIC_VERSIONS,
  SOURCE_INTEGRITY_STATES
} from "@/lib/domain/constants";

export type AssetType = (typeof ASSET_TYPES)[number];

export type DecisionLabel = (typeof DECISION_LABELS)[number];

export type SourceIntegrity = (typeof SOURCE_INTEGRITY_STATES)[number];

export type ConfidenceState = (typeof CONFIDENCE_STATES)[number];

export type ConfidenceReasonCode = (typeof CONFIDENCE_REASON_CODES)[number];

export type Criterion = (typeof ALL_CRITERIA)[number];

export type EvaluationState = (typeof EVALUATION_STATES)[number];

export type RubricVersion = (typeof RUBRIC_VERSIONS)[number];

export type ContextAssetOrigin = (typeof CONTEXT_ASSET_ORIGINS)[number];

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
  sha256: string | null;
  byte_size: number | null;
  note: string | null;
  pinned: 0 | 1;
  created_at: string;
}

export interface GenerationContext {
  id: string;
  style_profile_id: string;
  name: string;
  generation_goal: string | null;
  asset_focus: AssetType;
  target_use: string | null;
  source_prompt: string | null;
  tool_name: string | null;
  model_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface GenerationContextAsset {
  id: string;
  generation_context_id: string;
  reference_asset_id: string | null;
  origin: ContextAssetOrigin;
  asset_type: AssetType;
  file_path: string;
  thumbnail_path: string | null;
  sha256: string | null;
  byte_size: number | null;
  snapshot_note: string | null;
  created_at: string;
}

export interface PromptRevision {
  id: string;
  generation_context_id: string;
  parent_prompt_revision_id: string | null;
  source_guidance_id: string | null;
  revision_label: string | null;
  revision_note: string | null;
  prompt_text: string;
  negative_prompt: string | null;
  parameters_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CandidateImage {
  id: string;
  generation_context_id: string;
  prompt_revision_id: string | null;
  file_path: string;
  thumbnail_path: string | null;
  sha256: string | null;
  byte_size: number | null;
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
  rubric_version: RubricVersion;
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
  human_modified: 0 | 1;
  copied_at: string | null;
  created_at: string;
}

export interface EvaluationDraft {
  evaluation: Evaluation;
  criteria: EvaluationCriterion[];
  next_prompt_guidance: string;
  weak_reference_set: boolean;
  confidence_reasons: ConfidenceReasonCode[];
}
