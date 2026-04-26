import Database from "better-sqlite3";
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/lib/db/client";
import { getDbPath } from "@/lib/files/paths";
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
    const candidateColumns = db.prepare("PRAGMA table_info(candidate_images)").all() as Array<{ name: string }>;

    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'evaluation_sessions'").get())
      .toBeUndefined();
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
    expect(candidateColumns.some((column) => column.name === "prompt_revision_id")).toBe(true);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("20260425_prompt_revisions"))
      .toBeTruthy();
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("20260426_retire_evaluation_sessions"))
      .toBeTruthy();
  });
});
