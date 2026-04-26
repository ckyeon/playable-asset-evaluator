import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { assetAbsolutePath, ensureBaseDirs, getDataDir, getDbPath } from "@/lib/files/paths";

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
    cachedDb = null;
    cachedDbPath = null;
  }

  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    if (tableExists(db, "style_profiles")) {
      assertNoRetiredLegacySessionSchema(db);
    }
    ensureSchemaMigrationsTable(db);

    const schema = readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf8");
    if (tableExists(db, "style_profiles")) {
      runGenerationContextMigration(db, dbPath, dbExisted);
      runPromptRevisionMigration(db, dbPath, dbExisted);
      runImageMetadataMigration(db, dbPath, dbExisted);
      runPromptGuidanceHumanModifiedMigration(db, dbPath, dbExisted);
    }
    db.exec(schema);
    runLegacySessionCleanupMigration(db, dbPath, dbExisted);
    seedDefaultData(db);
    markMigrationApplied(db, GENERATION_CONTEXT_MIGRATION);
    markMigrationApplied(db, PROMPT_REVISION_MIGRATION);
    markMigrationApplied(db, LEGACY_SESSION_RETIREMENT_MIGRATION);
    markMigrationApplied(db, IMAGE_METADATA_MIGRATION);
    markMigrationApplied(db, PROMPT_GUIDANCE_HUMAN_MODIFIED_MIGRATION);

    cachedDb = db;
    cachedDbPath = dbPath;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
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
const LEGACY_SESSION_RETIREMENT_MIGRATION = "20260426_retire_evaluation_sessions";
const IMAGE_METADATA_MIGRATION = "20260426_persist_image_metadata";
const PROMPT_GUIDANCE_HUMAN_MODIFIED_MIGRATION = "20260426_track_human_modified_guidance";
const RETIRED_LEGACY_SESSION_SCHEMA_MESSAGE =
  "This Asset Evaluator database uses the retired evaluation_sessions schema. Upgrade it with an Asset Evaluator version from before 2026-04-26, or import the data into a fresh workspace.";

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

function assertNoRetiredLegacySessionSchema(db: Database.Database): void {
  const hasLegacySessions = tableExists(db, "evaluation_sessions");
  const hasGenerationContexts = tableExists(db, "generation_contexts");
  const hasCandidateImages = tableExists(db, "candidate_images");
  const candidateHasLegacySessionId = tableHasColumn(db, "candidate_images", "session_id");
  const candidateHasGenerationContextId = tableHasColumn(db, "candidate_images", "generation_context_id");

  if ((hasLegacySessions && !hasGenerationContexts) || (candidateHasLegacySessionId && !candidateHasGenerationContextId)) {
    throw new Error(RETIRED_LEGACY_SESSION_SCHEMA_MESSAGE);
  }

  if (hasCandidateImages && !candidateHasGenerationContextId) {
    throw new Error(
      "This Asset Evaluator database has an unsupported pre-generation-context candidate_images schema. " +
        "Import the data into a fresh workspace before opening it with this version."
    );
  }
}

function runGenerationContextMigration(db: Database.Database, dbPath: string, dbExisted: boolean): void {
  const needsMigration =
    !tableExists(db, "generation_contexts") ||
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

    ensureProfileDefaultContexts(db);

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

function runLegacySessionCleanupMigration(db: Database.Database, dbPath: string, dbExisted: boolean): void {
  if (!tableExists(db, "evaluation_sessions")) {
    markMigrationApplied(db, LEGACY_SESSION_RETIREMENT_MIGRATION);
    return;
  }

  const hasModernContextSchema =
    tableExists(db, "generation_contexts") &&
    tableExists(db, "candidate_images") &&
    tableHasColumn(db, "candidate_images", "generation_context_id") &&
    !tableHasColumn(db, "candidate_images", "session_id");

  if (!hasModernContextSchema) {
    throw new Error(RETIRED_LEGACY_SESSION_SCHEMA_MESSAGE);
  }

  if (dbExisted && !isMigrationApplied(db, LEGACY_SESSION_RETIREMENT_MIGRATION)) {
    backupDatabase(db, dbPath);
  }

  db.transaction(() => {
    db.exec(`
      DROP INDEX IF EXISTS idx_sessions_profile_created;
      DROP TABLE evaluation_sessions;
    `);
    markMigrationApplied(db, LEGACY_SESSION_RETIREMENT_MIGRATION);
  })();
}

function runImageMetadataMigration(db: Database.Database, dbPath: string, dbExisted: boolean): void {
  if (!needsImageMetadataMigration(db)) {
    markMigrationApplied(db, IMAGE_METADATA_MIGRATION);
    return;
  }

  if (dbExisted && !isMigrationApplied(db, IMAGE_METADATA_MIGRATION)) {
    backupDatabase(db, dbPath);
  }

  db.transaction(() => {
    ensureImageMetadataColumns(db);
    backfillImageMetadata(db);
    markMigrationApplied(db, IMAGE_METADATA_MIGRATION);
  })();
}

const IMAGE_METADATA_TABLES = ["reference_assets", "generation_context_assets", "candidate_images"] as const;

function needsImageMetadataMigration(db: Database.Database): boolean {
  const migrationApplied = isMigrationApplied(db, IMAGE_METADATA_MIGRATION);
  for (const tableName of IMAGE_METADATA_TABLES) {
    if (!tableExists(db, tableName)) {
      continue;
    }
    if (!tableHasColumn(db, tableName, "sha256") || !tableHasColumn(db, tableName, "byte_size")) {
      return true;
    }
    if (migrationApplied) {
      continue;
    }
    const row = db
      .prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE file_path IS NOT NULL AND (sha256 IS NULL OR byte_size IS NULL)`)
      .get() as { count: number };
    if (row.count > 0) {
      return true;
    }
  }
  return false;
}

function ensureImageMetadataColumns(db: Database.Database): void {
  for (const tableName of IMAGE_METADATA_TABLES) {
    if (!tableExists(db, tableName)) {
      continue;
    }
    if (!tableHasColumn(db, tableName, "sha256")) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN sha256 TEXT;`);
    }
    if (!tableHasColumn(db, tableName, "byte_size")) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN byte_size INTEGER;`);
    }
  }
}

function backfillImageMetadata(db: Database.Database): void {
  const metadataByPath = new Map<string, ImageMetadata | null>();

  for (const tableName of IMAGE_METADATA_TABLES) {
    if (
      !tableExists(db, tableName) ||
      !tableHasColumn(db, tableName, "sha256") ||
      !tableHasColumn(db, tableName, "byte_size")
    ) {
      continue;
    }

    const rows = db
      .prepare(`SELECT id, file_path FROM ${tableName} WHERE file_path IS NOT NULL AND (sha256 IS NULL OR byte_size IS NULL)`)
      .all() as Array<{ id: string; file_path: string }>;

    for (const row of rows) {
      const metadata = imageMetadataForRelativePath(row.file_path, metadataByPath);
      if (!metadata) {
        continue;
      }
      db.prepare(`UPDATE ${tableName} SET sha256 = ?, byte_size = ? WHERE id = ?`).run(
        metadata.sha256,
        metadata.byte_size,
        row.id
      );
    }
  }
}

interface ImageMetadata {
  sha256: string;
  byte_size: number;
}

function imageMetadataForRelativePath(
  relativePath: string,
  metadataByPath: Map<string, ImageMetadata | null>
): ImageMetadata | null {
  if (metadataByPath.has(relativePath)) {
    return metadataByPath.get(relativePath) || null;
  }

  let metadata: ImageMetadata | null = null;
  try {
    const absolutePath = assetAbsolutePath(relativePath);
    if (existsSync(absolutePath)) {
      const stat = statSync(absolutePath);
      if (stat.isFile()) {
        metadata = {
          sha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
          byte_size: stat.size
        };
      }
    }
  } catch {
    metadata = null;
  }

  metadataByPath.set(relativePath, metadata);
  return metadata;
}

function runPromptGuidanceHumanModifiedMigration(
  db: Database.Database,
  dbPath: string,
  dbExisted: boolean
): void {
  if (!needsPromptGuidanceHumanModifiedMigration(db)) {
    markMigrationApplied(db, PROMPT_GUIDANCE_HUMAN_MODIFIED_MIGRATION);
    return;
  }

  if (dbExisted && !isMigrationApplied(db, PROMPT_GUIDANCE_HUMAN_MODIFIED_MIGRATION)) {
    backupDatabase(db, dbPath);
  }

  db.transaction(() => {
    db.exec("ALTER TABLE prompt_guidance ADD COLUMN human_modified INTEGER NOT NULL DEFAULT 0;");
    markMigrationApplied(db, PROMPT_GUIDANCE_HUMAN_MODIFIED_MIGRATION);
  })();
}

function needsPromptGuidanceHumanModifiedMigration(db: Database.Database): boolean {
  return tableExists(db, "prompt_guidance") && !tableHasColumn(db, "prompt_guidance", "human_modified");
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
