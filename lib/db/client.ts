import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ensureBaseDirs, getDbPath } from "@/lib/files/paths";

let cachedDb: Database.Database | null = null;
let cachedDbPath: string | null = null;

export function getDb(): Database.Database {
  ensureBaseDirs();
  const dbPath = getDbPath();

  if (cachedDb && cachedDbPath === dbPath) {
    return cachedDb;
  }

  if (cachedDb) {
    cachedDb.close();
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf8");
  db.exec(schema);
  seedDefaultData(db);

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

function seedDefaultData(db: Database.Database): void {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM style_profiles").get() as { count: number };
  if (existing.count > 0) {
    return;
  }

  const profileId = randomUUID();
  const sessionId = randomUUID();
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
      sessionId,
      profileId,
      "Matgo -> Slot playable",
      "Initial playable ad where Matgo visuals were remixed into a casino slot machine concept."
    );
  });

  insert();
}
