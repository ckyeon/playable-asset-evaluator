PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS style_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  style_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS reference_assets (
  id TEXT PRIMARY KEY,
  style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('card', 'coin_reward', 'button_cta', 'background_effect', 'character', 'other')),
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  sha256 TEXT,
  byte_size INTEGER,
  note TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS generation_contexts (
  id TEXT PRIMARY KEY,
  style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  generation_goal TEXT,
  asset_focus TEXT NOT NULL DEFAULT 'other' CHECK (asset_focus IN ('card', 'coin_reward', 'button_cta', 'background_effect', 'character', 'other')),
  target_use TEXT,
  source_prompt TEXT,
  tool_name TEXT,
  model_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS generation_context_assets (
  id TEXT PRIMARY KEY,
  generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
  reference_asset_id TEXT REFERENCES reference_assets(id) ON DELETE SET NULL,
  origin TEXT NOT NULL CHECK (origin IN ('profile_reference', 'context_upload')),
  asset_type TEXT NOT NULL CHECK (asset_type IN ('card', 'coin_reward', 'button_cta', 'background_effect', 'character', 'other')),
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  sha256 TEXT,
  byte_size INTEGER,
  snapshot_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS candidate_images (
  id TEXT PRIMARY KEY,
  generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
  prompt_revision_id TEXT REFERENCES prompt_revisions(id) ON DELETE SET NULL,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  sha256 TEXT,
  byte_size INTEGER,
  generation_tool TEXT,
  prompt_text TEXT,
  prompt_missing INTEGER NOT NULL DEFAULT 0,
  source_integrity TEXT NOT NULL DEFAULT 'complete' CHECK (source_integrity IN ('complete', 'incomplete')),
  recovery_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS prompt_revisions (
  id TEXT PRIMARY KEY,
  generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
  parent_prompt_revision_id TEXT REFERENCES prompt_revisions(id) ON DELETE SET NULL,
  source_guidance_id TEXT REFERENCES prompt_guidance(id) ON DELETE SET NULL,
  revision_label TEXT,
  revision_note TEXT,
  prompt_text TEXT NOT NULL,
  negative_prompt TEXT,
  parameters_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  candidate_image_id TEXT NOT NULL REFERENCES candidate_images(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  fit_score INTEGER NOT NULL CHECK (fit_score >= 0 AND fit_score <= 100),
  decision_label TEXT NOT NULL CHECK (decision_label IN ('good', 'needs_edit', 'reject')),
  human_reason TEXT,
  ai_summary TEXT,
  raw_model_output_json TEXT,
  confidence_state TEXT NOT NULL CHECK (confidence_state IN ('normal', 'low_confidence')),
  evaluation_state TEXT NOT NULL DEFAULT 'draft' CHECK (evaluation_state IN ('draft', 'saved', 'failed')),
  rubric_version TEXT NOT NULL DEFAULT 'v2_generation_context' CHECK (rubric_version IN ('v1_style_profile', 'v2_generation_context')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS evaluation_criteria (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  criterion TEXT NOT NULL CHECK (criterion IN ('style_match', 'playable_readability', 'creative_appeal', 'production_usability', 'profile_fit', 'source_asset_match', 'prompt_intent_match')),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_guidance (
  id TEXT PRIMARY KEY,
  style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
  evaluation_id TEXT REFERENCES evaluations(id) ON DELETE SET NULL,
  guidance_text TEXT NOT NULL,
  confidence_state TEXT NOT NULL CHECK (confidence_state IN ('normal', 'low_confidence')),
  copied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_reference_assets_profile_type ON reference_assets(style_profile_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_reference_assets_profile_pinned ON reference_assets(style_profile_id, pinned, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_contexts_profile_updated ON generation_contexts(style_profile_id, updated_at, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_context_assets_context_origin ON generation_context_assets(generation_context_id, origin, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_context_assets_reference ON generation_context_assets(reference_asset_id);
CREATE INDEX IF NOT EXISTS idx_candidates_context_integrity ON candidate_images(generation_context_id, prompt_missing, source_integrity);
CREATE INDEX IF NOT EXISTS idx_candidates_prompt_revision ON candidate_images(prompt_revision_id);
CREATE INDEX IF NOT EXISTS idx_prompt_revisions_context_parent ON prompt_revisions(generation_context_id, parent_prompt_revision_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prompt_revisions_source_guidance ON prompt_revisions(source_guidance_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_candidate ON evaluations(candidate_image_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_label_confidence_created ON evaluations(decision_label, confidence_state, created_at);
CREATE INDEX IF NOT EXISTS idx_criteria_eval_criterion ON evaluation_criteria(evaluation_id, criterion);
CREATE INDEX IF NOT EXISTS idx_guidance_profile_confidence_created ON prompt_guidance(style_profile_id, confidence_state, created_at);
