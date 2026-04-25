import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureBaseDirs, getDataDir, getDbPath } from "@/lib/files/paths";

let cachedDb: Database.Database | null = null;
let cachedDbPath: string | null = null;

export function getDb(): Database.Database {
  ensureBaseDirs();
  const dbPath = getDbPath();
  const dbExisted = existsSync(dbPath);

  if (cachedDb && cachedDbPath === dbPath) {
    return cachedDb;
  }

  if (cachedDb) {
    cachedDb.close();
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchemaMigrationsTable(db);

  const schema = readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf8");
  if (tableExists(db, "style_profiles")) {
    runGenerationContextMigration(db, dbPath, dbExisted);
    runPromptRevisionMigration(db, dbPath, dbExisted);
  }
  db.exec(schema);
  seedDefaultData(db);
  markMigrationApplied(db, GENERATION_CONTEXT_MIGRATION);
  markMigrationApplied(db, PROMPT_REVISION_MIGRATION);

  cachedDb = db;
  cachedDbPath = dbPath;
  return db;
}

export function closeDbForTests(): void {
  if (cachedDb) {
    cachedDb.close();
    cachedDb = null;
    cachedDbPath = null;
  }
}

const GENERATION_CONTEXT_MIGRATION = "20260423_generation_context";
const PROMPT_REVISION_MIGRATION = "20260425_prompt_revisions";

function ensureSchemaMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(row);
}

function tableHasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  if (!tableExists(db, tableName)) {
    return false;
  }
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function tableSql(db: Database.Database, tableName: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string } | undefined;
  return row?.sql || "";
}

function isMigrationApplied(db: Database.Database, version: string): boolean {
  const row = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version);
  return Boolean(row);
}

function markMigrationApplied(db: Database.Database, version: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at)
     VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
  ).run(version);
}

function runGenerationContextMigration(db: Database.Database, dbPath: string, dbExisted: boolean): void {
  const needsMigration =
    !tableExists(db, "generation_contexts") ||
    (tableExists(db, "candidate_images") && !tableHasColumn(db, "candidate_images", "generation_context_id")) ||
    (tableExists(db, "evaluations") && !tableHasColumn(db, "evaluations", "rubric_version")) ||
    (tableExists(db, "evaluation_criteria") && !tableSql(db, "evaluation_criteria").includes("profile_fit"));

  if (!needsMigration) {
    markMigrationApplied(db, GENERATION_CONTEXT_MIGRATION);
    return;
  }

  if (dbExisted && !isMigrationApplied(db, GENERATION_CONTEXT_MIGRATION)) {
    backupDatabase(db, dbPath);
  }

  const migrate = db.transaction(() => {
    db.exec(`
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
        snapshot_note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    if (tableExists(db, "evaluation_sessions")) {
      db.prepare(
        `INSERT OR IGNORE INTO generation_contexts
          (id, style_profile_id, name, generation_goal, asset_focus, target_use, source_prompt, tool_name, model_name, created_at, updated_at)
         SELECT id, style_profile_id, name, source_context, 'other', NULL, NULL, NULL, NULL, created_at, created_at
         FROM evaluation_sessions`
      ).run();
    }

    ensureProfileDefaultContexts(db);

    if (tableExists(db, "candidate_images") && !tableHasColumn(db, "candidate_images", "generation_context_id")) {
      db.exec(`
        CREATE TABLE candidate_images_new (
          id TEXT PRIMARY KEY,
          generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
          file_path TEXT NOT NULL,
          thumbnail_path TEXT,
          generation_tool TEXT,
          prompt_text TEXT,
          prompt_missing INTEGER NOT NULL DEFAULT 0,
          source_integrity TEXT NOT NULL DEFAULT 'complete' CHECK (source_integrity IN ('complete', 'incomplete')),
          recovery_note TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
      db.prepare(
        `INSERT INTO candidate_images_new
          (id, generation_context_id, file_path, thumbnail_path, generation_tool, prompt_text, prompt_missing, source_integrity, recovery_note, created_at)
         SELECT id, session_id, file_path, thumbnail_path, generation_tool, prompt_text, prompt_missing, source_integrity, recovery_note, created_at
         FROM candidate_images`
      ).run();
      db.exec("DROP TABLE candidate_images; ALTER TABLE candidate_images_new RENAME TO candidate_images;");
    }

    if (tableExists(db, "evaluations") && !tableHasColumn(db, "evaluations", "rubric_version")) {
      db.exec("ALTER TABLE evaluations ADD COLUMN rubric_version TEXT NOT NULL DEFAULT 'v1_style_profile';");
    }

    if (tableExists(db, "evaluation_criteria") && !tableSql(db, "evaluation_criteria").includes("profile_fit")) {
      db.exec(`
        CREATE TABLE evaluation_criteria_new (
          id TEXT PRIMARY KEY,
          evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
          criterion TEXT NOT NULL CHECK (criterion IN ('style_match', 'playable_readability', 'creative_appeal', 'production_usability', 'profile_fit', 'source_asset_match', 'prompt_intent_match')),
          score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
          reason TEXT NOT NULL
        );
        INSERT INTO evaluation_criteria_new (id, evaluation_id, criterion, score, reason)
        SELECT id, evaluation_id, criterion, score, reason FROM evaluation_criteria;
        DROP TABLE evaluation_criteria;
        ALTER TABLE evaluation_criteria_new RENAME TO evaluation_criteria;
      `);
    }

    markMigrationApplied(db, GENERATION_CONTEXT_MIGRATION);
  });

  db.pragma("foreign_keys = OFF");
  try {
    migrate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function runPromptRevisionMigration(db: Database.Database, dbPath: string, dbExisted: boolean): void {
  const needsMigration =
    !tableExists(db, "prompt_revisions") ||
    (tableExists(db, "candidate_images") && !tableHasColumn(db, "candidate_images", "prompt_revision_id")) ||
    hasUnlinkedCandidatePrompts(db);

  if (!needsMigration) {
    markMigrationApplied(db, PROMPT_REVISION_MIGRATION);
    return;
  }

  if (dbExisted && !isMigrationApplied(db, PROMPT_REVISION_MIGRATION)) {
    backupDatabase(db, dbPath);
  }

  const migrate = db.transaction(() => {
    ensurePromptRevisionSchema(db);
    backfillPromptRevisions(db);
    markMigrationApplied(db, PROMPT_REVISION_MIGRATION);
  });

  db.pragma("foreign_keys = OFF");
  try {
    migrate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function ensurePromptRevisionSchema(db: Database.Database): void {
  db.exec(`
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
  `);

  if (tableExists(db, "candidate_images") && !tableHasColumn(db, "candidate_images", "prompt_revision_id")) {
    db.exec("ALTER TABLE candidate_images ADD COLUMN prompt_revision_id TEXT REFERENCES prompt_revisions(id) ON DELETE SET NULL;");
  }
}

function hasUnlinkedCandidatePrompts(db: Database.Database): boolean {
  if (!tableExists(db, "candidate_images") || !tableHasColumn(db, "candidate_images", "prompt_revision_id")) {
    return false;
  }

  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM candidate_images
       WHERE prompt_revision_id IS NULL
         AND prompt_text IS NOT NULL
         AND TRIM(prompt_text) <> ''`
    )
    .get() as { count: number };
  return row.count > 0;
}

function backfillPromptRevisions(db: Database.Database): void {
  if (!tableExists(db, "candidate_images") || !tableHasColumn(db, "candidate_images", "prompt_revision_id")) {
    return;
  }

  const candidates = db
    .prepare(
      `SELECT id, generation_context_id, prompt_text, created_at
       FROM candidate_images
       WHERE prompt_revision_id IS NULL
         AND prompt_text IS NOT NULL
         AND TRIM(prompt_text) <> ''
       ORDER BY generation_context_id, TRIM(prompt_text), created_at, id`
    )
    .all() as Array<{ id: string; generation_context_id: string; prompt_text: string; created_at: string }>;

  const revisionIdsByPrompt = new Map<string, string>();

  for (const candidate of candidates) {
    const promptText = candidate.prompt_text.trim();
    const key = `${candidate.generation_context_id}\u0000${promptText}`;
    let revisionId = revisionIdsByPrompt.get(key);

    if (!revisionId) {
      const existing = db
        .prepare(
          `SELECT id
           FROM prompt_revisions
           WHERE generation_context_id = ?
             AND parent_prompt_revision_id IS NULL
             AND source_guidance_id IS NULL
             AND prompt_text = ?
           ORDER BY created_at, id
           LIMIT 1`
        )
        .get(candidate.generation_context_id, promptText) as { id: string } | undefined;

      revisionId = existing?.id || randomUUID();
      revisionIdsByPrompt.set(key, revisionId);

      if (!existing) {
        db.prepare(
          `INSERT INTO prompt_revisions
            (id, generation_context_id, parent_prompt_revision_id, source_guidance_id, revision_label, revision_note, prompt_text, negative_prompt, parameters_json, created_at, updated_at)
           VALUES (?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)`
        ).run(revisionId, candidate.generation_context_id, promptText, candidate.created_at, candidate.created_at);
      }
    }

    db.prepare("UPDATE candidate_images SET prompt_revision_id = ? WHERE id = ?").run(revisionId, candidate.id);
  }
}

function ensureProfileDefaultContexts(db: Database.Database): void {
  const profiles = db
    .prepare(
      `SELECT id, name, created_at
       FROM style_profiles
       WHERE id NOT IN (SELECT style_profile_id FROM generation_contexts)`
    )
    .all() as Array<{ id: string; name: string; created_at: string }>;

  for (const profile of profiles) {
    const contextId = randomUUID();
    db.prepare(
      `INSERT INTO generation_contexts
        (id, style_profile_id, name, generation_goal, asset_focus, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'other', ?, ?)`
    ).run(contextId, profile.id, "Default generation context", profile.created_at, profile.created_at);
    db.prepare(
      `INSERT OR IGNORE INTO evaluation_sessions (id, style_profile_id, name, source_context, created_at)
       VALUES (?, ?, ?, NULL, ?)`
    ).run(contextId, profile.id, "Default generation context", profile.created_at);
  }
}

function backupDatabase(db: Database.Database, dbPath: string): void {
  db.pragma("wal_checkpoint(FULL)");
  const backupDir = path.join(getDataDir(), "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(dbPath, path.join(backupDir, `asset-evaluator-before-${stamp}.sqlite`));
}

function seedDefaultData(db: Database.Database): void {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM style_profiles").get() as { count: number };
  if (existing.count > 0) {
    return;
  }

  const profileId = randomUUID();
  const contextId = randomUUID();
  const styleSummary =
    "Korean card game casino remix: bright readable mobile-game rendering, crisp card silhouettes, celebratory reward language, and restrained casino sparkle.";

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO style_profiles (id, name, description, style_summary)
       VALUES (?, ?, ?, ?)`
    ).run(
      profileId,
      "Korean card game casino remix",
      "Reusable visual memory for Matgo-inspired casino slot playable assets.",
      styleSummary
    );

    db.prepare(
      `INSERT INTO evaluation_sessions (id, style_profile_id, name, source_context)
       VALUES (?, ?, ?, ?)`
    ).run(
      contextId,
      profileId,
      "Matgo -> Slot playable",
      "Initial playable ad where Matgo visuals were remixed into a casino slot machine concept."
    );

    db.prepare(
      `INSERT INTO generation_contexts
        (id, style_profile_id, name, generation_goal, asset_focus, target_use, source_prompt, tool_name, model_name)
       VALUES (?, ?, ?, ?, 'other', ?, NULL, NULL, NULL)`
    ).run(
      contextId,
      profileId,
      "Matgo -> Slot playable",
      "Initial playable ad where Matgo visuals were remixed into a casino slot machine concept.",
      "Playable ad asset evaluation"
    );
  });

  insert();
}
