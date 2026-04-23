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
  note TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS evaluation_sessions (
  id TEXT PRIMARY KEY,
  style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_context TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS candidate_images (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES evaluation_sessions(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  generation_tool TEXT,
  prompt_text TEXT,
  prompt_missing INTEGER NOT NULL DEFAULT 0,
  source_integrity TEXT NOT NULL DEFAULT 'complete' CHECK (source_integrity IN ('complete', 'incomplete')),
  recovery_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS evaluation_criteria (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  criterion TEXT NOT NULL CHECK (criterion IN ('style_match', 'playable_readability', 'creative_appeal', 'production_usability')),
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
CREATE INDEX IF NOT EXISTS idx_sessions_profile_created ON evaluation_sessions(style_profile_id, created_at);
CREATE INDEX IF NOT EXISTS idx_candidates_session_integrity ON candidate_images(session_id, prompt_missing, source_integrity);
CREATE INDEX IF NOT EXISTS idx_evaluations_candidate ON evaluations(candidate_image_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_label_confidence_created ON evaluations(decision_label, confidence_state, created_at);
CREATE INDEX IF NOT EXISTS idx_criteria_eval_criterion ON evaluation_criteria(evaluation_id, criterion);
CREATE INDEX IF NOT EXISTS idx_guidance_profile_confidence_created ON prompt_guidance(style_profile_id, confidence_state, created_at);
