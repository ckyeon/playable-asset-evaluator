export const ASSET_TYPES = [
  "card",
  "coin_reward",
  "button_cta",
  "background_effect",
  "character",
  "other"
] as const;

export const DECISION_LABELS = ["good", "needs_edit", "reject"] as const;

export const SOURCE_INTEGRITY_STATES = ["complete", "incomplete"] as const;

export const CONFIDENCE_STATES = ["normal", "low_confidence"] as const;

export const CONFIDENCE_REASON_CODES = [
  "prompt_missing",
  "weak_source_assets",
  "missing_source_file",
  "incomplete_source_metadata",
  "model_failed",
  "manual_recovery_note_required"
] as const;

export const EVALUATION_STATES = ["draft", "saved", "failed"] as const;

export const RUBRIC_VERSIONS = ["v1_style_profile", "v2_generation_context"] as const;

export const V1_CRITERIA = [
  "style_match",
  "playable_readability",
  "creative_appeal",
  "production_usability"
] as const;

export const V2_CRITERIA = [
  "profile_fit",
  "source_asset_match",
  "prompt_intent_match",
  "production_usability"
] as const;

export const ALL_CRITERIA = [...V1_CRITERIA, "profile_fit", "source_asset_match", "prompt_intent_match"] as const;

export const CONTEXT_ASSET_ORIGINS = ["profile_reference", "context_upload"] as const;
