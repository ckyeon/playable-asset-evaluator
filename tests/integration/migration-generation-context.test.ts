import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/lib/db/client";
import { assetAbsolutePath, getDbPath } from "@/lib/files/paths";
import { useTempDataDir } from "../helpers";

describe("generation context migration", () => {
  it("rejects retired v1 session databases instead of backfilling them", () => {
    useTempDataDir();
    const oldDb = new Database(getDbPath());
    oldDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE style_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        style_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE reference_assets (
        id TEXT PRIMARY KEY,
        style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
        asset_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT,
        note TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE evaluation_sessions (
        id TEXT PRIMARY KEY,
        style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        source_context TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE candidate_images (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES evaluation_sessions(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT,
        generation_tool TEXT,
        prompt_text TEXT,
        prompt_missing INTEGER NOT NULL DEFAULT 0,
        source_integrity TEXT NOT NULL DEFAULT 'complete',
        recovery_note TEXT,
        created_at TEXT NOT NULL
      );

      INSERT INTO style_profiles VALUES ('profile-1', 'Profile', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO evaluation_sessions VALUES ('session-1', 'profile-1', 'Old Session', 'Old source context', '2026-01-01T00:00:00.000Z');
      INSERT INTO candidate_images VALUES ('candidate-1', 'session-1', 'assets/candidate.png', NULL, 'tool', '  prompt  ', 0, 'complete', NULL, '2026-01-01T00:00:01.000Z');
    `);
    oldDb.close();
    closeDbForTests();

    expect(() => getDb()).toThrow(/retired evaluation_sessions schema/);

    const rawDb = new Database(getDbPath());
    expect(rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'generation_contexts'").get())
      .toBeUndefined();
    expect(rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'prompt_revisions'").get())
      .toBeUndefined();
    expect(rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get())
      .toBeUndefined();
    rawDb.close();
  });

  it("drops stale evaluation_sessions from already-modern databases", () => {
    const dataDir = useTempDataDir();
    const oldDb = new Database(getDbPath());
    oldDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE style_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        style_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE evaluation_sessions (
        id TEXT PRIMARY KEY,
        style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        source_context TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_profile_created ON evaluation_sessions(style_profile_id, created_at);
      CREATE TABLE generation_contexts (
        id TEXT PRIMARY KEY,
        style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        generation_goal TEXT,
        asset_focus TEXT NOT NULL DEFAULT 'other',
        target_use TEXT,
        source_prompt TEXT,
        tool_name TEXT,
        model_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE candidate_images (
        id TEXT PRIMARY KEY,
        generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT,
        generation_tool TEXT,
        prompt_text TEXT,
        prompt_missing INTEGER NOT NULL DEFAULT 0,
        source_integrity TEXT NOT NULL DEFAULT 'complete',
        recovery_note TEXT,
        created_at TEXT NOT NULL
      );

      INSERT INTO style_profiles VALUES ('profile-1', 'Profile', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO evaluation_sessions VALUES ('context-1', 'profile-1', 'Stale session row', 'No longer used', '2026-01-01T00:00:00.000Z');
      INSERT INTO generation_contexts VALUES ('context-1', 'profile-1', 'Modern Context', 'Goal', 'other', NULL, 'prompt', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO candidate_images VALUES ('candidate-1', 'context-1', 'assets/candidate.png', NULL, 'tool', 'prompt', 0, 'complete', NULL, '2026-01-01T00:00:01.000Z');
    `);
    oldDb.close();
    closeDbForTests();

    const db = getDb();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'evaluation_sessions'").get())
      .toBeUndefined();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_sessions_profile_created'").get())
      .toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS count FROM generation_contexts").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM prompt_revisions").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("20260426_retire_evaluation_sessions"))
      .toBeTruthy();
    expect(existsSync(`${dataDir}/backups`)).toBe(true);
    expect(readdirSync(`${dataDir}/backups`).some((file) => file.endsWith(".sqlite"))).toBe(true);
  });

  it("creates prompt revision tables without legacy sessions for fresh databases", () => {
    useTempDataDir();
    const db = getDb();
    const promptRevisionColumns = db.prepare("PRAGMA table_info(prompt_revisions)").all() as Array<{ name: string }>;
    const promptGuidanceColumns = db.prepare("PRAGMA table_info(prompt_guidance)").all() as Array<{ name: string }>;
    const referenceColumns = db.prepare("PRAGMA table_info(reference_assets)").all() as Array<{ name: string }>;
    const contextAssetColumns = db.prepare("PRAGMA table_info(generation_context_assets)").all() as Array<{ name: string }>;
    const candidateColumns = db.prepare("PRAGMA table_info(candidate_images)").all() as Array<{ name: string }>;

    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'evaluation_sessions'").get())
      .toBeUndefined();
    expect(referenceColumns.map((column) => column.name)).toEqual([
      "id",
      "style_profile_id",
      "asset_type",
      "file_path",
      "thumbnail_path",
      "sha256",
      "byte_size",
      "note",
      "pinned",
      "created_at"
    ]);
    expect(contextAssetColumns.map((column) => column.name)).toEqual([
      "id",
      "generation_context_id",
      "reference_asset_id",
      "origin",
      "asset_type",
      "file_path",
      "thumbnail_path",
      "sha256",
      "byte_size",
      "snapshot_note",
      "created_at"
    ]);
    expect(promptRevisionColumns.map((column) => column.name)).toEqual([
      "id",
      "generation_context_id",
      "parent_prompt_revision_id",
      "source_guidance_id",
      "revision_label",
      "revision_note",
      "prompt_text",
      "negative_prompt",
      "parameters_json",
      "created_at",
      "updated_at"
    ]);
    expect(promptGuidanceColumns.map((column) => column.name)).toEqual([
      "id",
      "style_profile_id",
      "evaluation_id",
      "guidance_text",
      "confidence_state",
      "human_modified",
      "copied_at",
      "created_at"
    ]);
    expect(candidateColumns.map((column) => column.name)).toEqual([
      "id",
      "generation_context_id",
      "prompt_revision_id",
      "file_path",
      "thumbnail_path",
      "sha256",
      "byte_size",
      "generation_tool",
      "prompt_text",
      "prompt_missing",
      "source_integrity",
      "recovery_note",
      "created_at"
    ]);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("20260425_prompt_revisions"))
      .toBeTruthy();
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("20260426_retire_evaluation_sessions"))
      .toBeTruthy();
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("20260426_persist_image_metadata"))
      .toBeTruthy();
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("20260426_track_human_modified_guidance"))
      .toBeTruthy();
  });

  it("adds and backfills image metadata columns for existing modern databases", () => {
    const dataDir = useTempDataDir();
    const relativePath = "assets/legacy/shared.png";
    const bytes = Buffer.from("legacy image bytes");
    const absolutePath = assetAbsolutePath(relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes);

    const oldDb = new Database(getDbPath());
    oldDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE style_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        style_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE reference_assets (
        id TEXT PRIMARY KEY,
        style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
        asset_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT,
        note TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE generation_contexts (
        id TEXT PRIMARY KEY,
        style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        generation_goal TEXT,
        asset_focus TEXT NOT NULL DEFAULT 'other',
        target_use TEXT,
        source_prompt TEXT,
        tool_name TEXT,
        model_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE generation_context_assets (
        id TEXT PRIMARY KEY,
        generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
        reference_asset_id TEXT REFERENCES reference_assets(id) ON DELETE SET NULL,
        origin TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT,
        snapshot_note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE candidate_images (
        id TEXT PRIMARY KEY,
        generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT,
        generation_tool TEXT,
        prompt_text TEXT,
        prompt_missing INTEGER NOT NULL DEFAULT 0,
        source_integrity TEXT NOT NULL DEFAULT 'complete',
        recovery_note TEXT,
        created_at TEXT NOT NULL
      );

      INSERT INTO style_profiles VALUES ('profile-1', 'Profile', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO generation_contexts VALUES ('context-1', 'profile-1', 'Modern Context', 'Goal', 'other', NULL, 'prompt', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO reference_assets VALUES ('reference-1', 'profile-1', 'character', '${relativePath}', NULL, 'legacy note', 0, '2026-01-01T00:00:01.000Z');
      INSERT INTO generation_context_assets VALUES ('source-1', 'context-1', 'reference-1', 'profile_reference', 'character', '${relativePath}', NULL, 'legacy snapshot', '2026-01-01T00:00:02.000Z');
      INSERT INTO candidate_images VALUES ('candidate-1', 'context-1', 'assets/legacy/missing.png', NULL, 'tool', 'prompt', 0, 'complete', NULL, '2026-01-01T00:00:03.000Z');
    `);
    oldDb.close();
    closeDbForTests();

    const expectedHash = createHash("sha256").update(bytes).digest("hex");
    const db = getDb();

    for (const tableName of ["reference_assets", "generation_context_assets", "candidate_images"]) {
      const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["sha256", "byte_size"]));
    }
    expect(db.prepare("SELECT sha256, byte_size FROM reference_assets WHERE id = 'reference-1'").get()).toEqual({
      sha256: expectedHash,
      byte_size: bytes.length
    });
    expect(db.prepare("SELECT sha256, byte_size FROM generation_context_assets WHERE id = 'source-1'").get()).toEqual({
      sha256: expectedHash,
      byte_size: bytes.length
    });
    expect(db.prepare("SELECT sha256, byte_size FROM candidate_images WHERE id = 'candidate-1'").get()).toEqual({
      sha256: null,
      byte_size: null
    });
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("20260426_persist_image_metadata"))
      .toBeTruthy();
    expect(existsSync(`${dataDir}/backups`)).toBe(true);
  });

  it("adds human-modified provenance to existing prompt guidance", () => {
    const dataDir = useTempDataDir();
    const oldDb = new Database(getDbPath());
    oldDb.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE style_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        style_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE generation_contexts (
        id TEXT PRIMARY KEY,
        style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        generation_goal TEXT,
        asset_focus TEXT NOT NULL DEFAULT 'other',
        target_use TEXT,
        source_prompt TEXT,
        tool_name TEXT,
        model_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE candidate_images (
        id TEXT PRIMARY KEY,
        generation_context_id TEXT NOT NULL REFERENCES generation_contexts(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT,
        generation_tool TEXT,
        prompt_text TEXT,
        prompt_missing INTEGER NOT NULL DEFAULT 0,
        source_integrity TEXT NOT NULL DEFAULT 'complete',
        recovery_note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE evaluations (
        id TEXT PRIMARY KEY,
        candidate_image_id TEXT NOT NULL REFERENCES candidate_images(id) ON DELETE CASCADE,
        model_name TEXT NOT NULL,
        fit_score INTEGER NOT NULL,
        decision_label TEXT NOT NULL,
        human_reason TEXT,
        ai_summary TEXT,
        raw_model_output_json TEXT,
        confidence_state TEXT NOT NULL,
        evaluation_state TEXT NOT NULL DEFAULT 'draft',
        rubric_version TEXT NOT NULL DEFAULT 'v2_generation_context',
        created_at TEXT NOT NULL
      );
      CREATE TABLE prompt_guidance (
        id TEXT PRIMARY KEY,
        style_profile_id TEXT NOT NULL REFERENCES style_profiles(id) ON DELETE CASCADE,
        evaluation_id TEXT REFERENCES evaluations(id) ON DELETE SET NULL,
        guidance_text TEXT NOT NULL,
        confidence_state TEXT NOT NULL,
        copied_at TEXT,
        created_at TEXT NOT NULL
      );

      INSERT INTO style_profiles VALUES ('profile-1', 'Profile', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO generation_contexts VALUES ('context-1', 'profile-1', 'Modern Context', 'Goal', 'other', NULL, 'prompt', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      INSERT INTO candidate_images VALUES ('candidate-1', 'context-1', 'assets/candidate.png', NULL, 'tool', 'prompt', 0, 'complete', NULL, '2026-01-01T00:00:01.000Z');
      INSERT INTO evaluations VALUES ('evaluation-1', 'candidate-1', 'mock-evaluator-v1', 72, 'needs_edit', 'reason', NULL, NULL, 'normal', 'saved', 'v2_generation_context', '2026-01-01T00:00:02.000Z');
      INSERT INTO prompt_guidance VALUES ('guidance-1', 'profile-1', 'evaluation-1', 'Keep the character clearer.', 'normal', NULL, '2026-01-01T00:00:03.000Z');
    `);
    oldDb.close();
    closeDbForTests();

    const db = getDb();
    const columns = db.prepare("PRAGMA table_info(prompt_guidance)").all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["human_modified"]));
    expect(db.prepare("SELECT human_modified FROM prompt_guidance WHERE id = 'guidance-1'").get()).toEqual({
      human_modified: 0
    });
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("20260426_track_human_modified_guidance"))
      .toBeTruthy();
    expect(existsSync(`${dataDir}/backups`)).toBe(true);
  });
});
