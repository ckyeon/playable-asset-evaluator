export type DecisionLabel = "good" | "needs_edit" | "reject";
export type ConfidenceState = "normal" | "low_confidence";
export type RevisionUploadMode = "new_root" | "new_child" | "attach_existing";
export type PromptRevisionEffectiveness = "improved" | "flat" | "regressed" | "unknown";
export type PromptRevisionEffectivenessReason =
  | "improved"
  | "flat"
  | "regressed"
  | "root_revision"
  | "no_saved_evaluation"
  | "parent_no_saved_evaluation"
  | "broken_lineage";

export interface StyleProfile {
  id: string;
  name: string;
  description: string | null;
  style_summary: string | null;
  updated_at: string;
}

export interface ReferenceAsset {
  id: string;
  asset_type: string;
  file_path: string;
  thumbnail_path: string | null;
  sha256: string | null;
  byte_size: number | null;
  note: string | null;
  imageUrl: string | null;
}

export interface GenerationContext {
  id: string;
  style_profile_id: string;
  name: string;
  generation_goal: string | null;
  asset_focus: string;
  target_use: string | null;
  source_prompt: string | null;
  tool_name: string | null;
  model_name: string | null;
  updated_at: string;
  reference_strength: "none" | "weak" | "strong";
  confidence_reasons: string[];
  candidate_count: number;
  saved_judgment_count: number;
  sourceAssets: ContextSourceAsset[];
  promptRevisions: PromptRevision[];
}

export interface ContextSourceAsset {
  id: string;
  generation_context_id: string;
  reference_asset_id: string | null;
  origin: "profile_reference" | "context_upload";
  asset_type: string;
  file_path: string;
  thumbnail_path: string | null;
  sha256: string | null;
  byte_size: number | null;
  snapshot_note: string | null;
  imageUrl: string | null;
}

export interface Candidate {
  id: string;
  generation_context_id: string;
  prompt_revision_id: string | null;
  file_path: string;
  thumbnail_path: string | null;
  sha256: string | null;
  byte_size: number | null;
  prompt_text: string | null;
  prompt_missing: 0 | 1;
  recovery_note: string | null;
  source_integrity: "complete" | "incomplete";
  promptRevision: PromptRevision | null;
  imageUrl: string | null;
  originalUrl: string | null;
}

export interface PromptRevision {
  id: string;
  generation_context_id: string;
  parent_prompt_revision_id: string | null;
  source_guidance_id: string | null;
  sourceGuidance: PromptGuidance | null;
  revision_label: string | null;
  revision_note: string | null;
  prompt_text: string;
  negative_prompt: string | null;
  parameters_json: string | null;
  created_at: string;
  updated_at: string;
  candidate_ids: string[];
  candidate_count: number;
  effectiveness: PromptRevisionEffectiveness;
  effectiveness_reason: PromptRevisionEffectivenessReason;
}

export interface Criterion {
  criterion: string;
  score: number;
  reason: string;
}

export interface Evaluation {
  id: string;
  fit_score: number;
  decision_label: DecisionLabel;
  human_reason: string | null;
  ai_summary: string | null;
  confidence_state: ConfidenceState;
  evaluation_state: "draft" | "saved" | "failed";
  criteria?: Criterion[];
  prompt_guidance?: PromptGuidance[];
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

export interface SourceGuidanceOption {
  id: string;
  evaluation_id: string;
  candidate_id: string;
  guidance_text: string;
  confidence_state: ConfidenceState;
  created_at: string;
  decision_label: DecisionLabel;
  fit_score: number;
}

export interface ProfileDetail {
  profile: StyleProfile;
  referenceAssets: ReferenceAsset[];
  generationContexts: GenerationContext[];
  candidates: Candidate[];
}

export interface Draft {
  evaluation: Evaluation;
  criteria: Criterion[];
  next_prompt_guidance: string;
  weak_reference_set: boolean;
}

export interface HistoryItem {
  generationContext: {
    id: string;
    style_profile_id: string;
    name: string;
    generation_goal: string | null;
    asset_focus: string;
    target_use: string | null;
    source_prompt: string | null;
    tool_name: string | null;
    model_name: string | null;
    created_at: string;
    updated_at: string;
    reference_strength: "none" | "weak" | "strong";
    confidence_reasons: string[];
  };
  candidate: Candidate;
  evaluations: Evaluation[];
}

export interface WorkspaceStatus {
  kind: "ok" | "error" | "info";
  text: string;
}

export const assetTypes = [
  ["card", "Card"],
  ["coin_reward", "Coin / reward"],
  ["button_cta", "Button / CTA"],
  ["background_effect", "Background / effect"],
  ["character", "Character"],
  ["other", "Other"]
] as const;
