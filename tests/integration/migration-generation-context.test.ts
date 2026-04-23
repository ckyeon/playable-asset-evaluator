import Database from "better-sqlite3";
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "@/lib/db/client";
import { getDbPath } from "@/lib/files/paths";
import { useTempDataDir } from "../helpers";

describe("generation context migration", () => {
  it("backs up and migrates v1 sessions, candidates, evaluations, criteria, and guidance", () => {
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
        created_at TEXT NOT NULL
      );
      CREATE TABLE evaluation_criteria (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
        criterion TEXT NOT NULL CHECK (criterion IN ('style_match', 'playable_readability', 'creative_appeal', 'production_usability')),
        score INTEGER NOT NULL,
        reason TEXT NOT NULL
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
      INSERT INTO evaluation_sessions VALUES ('session-1', 'profile-1', 'Old Session', 'Old source context', '2026-01-01T00:00:00.000Z');
      INSERT INTO candidate_images VALUES ('candidate-1', 'session-1', 'assets/candidate.png', NULL, 'tool', 'prompt', 0, 'complete', NULL, '2026-01-01T00:00:01.000Z');
      INSERT INTO evaluations VALUES ('evaluation-1', 'candidate-1', 'model', 77, 'needs_edit', 'reason', 'summary', '{}', 'normal', 'saved', '2026-01-01T00:00:02.000Z');
      INSERT INTO evaluation_criteria VALUES ('criterion-1', 'evaluation-1', 'style_match', 77, 'old reason');
      INSERT INTO prompt_guidance VALUES ('guidance-1', 'profile-1', 'evaluation-1', 'next prompt', 'normal', NULL, '2026-01-01T00:00:03.000Z');
    `);
    oldDb.close();
    closeDbForTests();

    const db = getDb();
    expect(db.prepare("SELECT name FROM generation_contexts WHERE id = ?").get("session-1")).toEqual({
      name: "Old Session"
    });
    expect(db.prepare("SELECT generation_context_id FROM candidate_images WHERE id = ?").get("candidate-1")).toEqual({
      generation_context_id: "session-1"
    });
    expect(db.prepare("SELECT rubric_version FROM evaluations WHERE id = ?").get("evaluation-1")).toEqual({
      rubric_version: "v1_style_profile"
    });
    expect(() =>
      db
        .prepare("INSERT INTO evaluation_criteria VALUES ('criterion-2', 'evaluation-1', 'profile_fit', 80, 'new reason')")
        .run()
    ).not.toThrow();
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get("20260423_generation_context"))
      .toBeTruthy();
    expect(existsSync(`${dataDir}/backups`)).toBe(true);
    expect(readdirSync(`${dataDir}/backups`).some((file) => file.endsWith(".sqlite"))).toBe(true);

    closeDbForTests();
    const rerun = getDb();
    expect(rerun.prepare("SELECT COUNT(*) AS count FROM generation_contexts").get()).toEqual({ count: 1 });
  });
});
