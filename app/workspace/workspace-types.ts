export type DecisionLabel = "good" | "needs_edit" | "reject";
export type ConfidenceState = "normal" | "low_confidence";

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
  note: string | null;
  imageUrl: string | null;
}

export interface Session {
  id: string;
  name: string;
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
}

export interface ContextSourceAsset {
  id: string;
  generation_context_id: string;
  reference_asset_id: string | null;
  origin: "profile_reference" | "context_upload";
  asset_type: string;
  file_path: string;
  thumbnail_path: string | null;
  snapshot_note: string | null;
  imageUrl: string | null;
}

export interface Candidate {
  id: string;
  generation_context_id: string;
  file_path: string;
  thumbnail_path: string | null;
  prompt_text: string | null;
  prompt_missing: 0 | 1;
  recovery_note: string | null;
  source_integrity: "complete" | "incomplete";
  imageUrl: string | null;
  originalUrl: string | null;
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
  prompt_guidance?: Array<{ guidance_text: string }>;
}

export interface ProfileDetail {
  profile: StyleProfile;
  referenceAssets: ReferenceAsset[];
  generationContexts: GenerationContext[];
  sessions: Session[];
  candidates: Candidate[];
}

export interface Draft {
  evaluation: Evaluation;
  criteria: Criterion[];
  next_prompt_guidance: string;
  weak_reference_set: boolean;
}

export interface HistoryItem {
  session: Session;
  generationContext?: GenerationContext;
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
