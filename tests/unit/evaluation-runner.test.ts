import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { EvaluationRunner } from "@/lib/services/evaluation-runner";
import { useTempDataDir } from "../helpers";

describe("EvaluationRunner", () => {
  it("caps the selected reference subset at eight assets", () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };

    for (let index = 0; index < 10; index += 1) {
      db.prepare(
        `INSERT INTO reference_assets (id, style_profile_id, asset_type, file_path, thumbnail_path, note, pinned)
         VALUES (?, ?, 'card', ?, NULL, ?, ?)`
      ).run(randomUUID(), profile.id, `assets/ref-${index}.png`, `ref ${index}`, index < 2 ? 1 : 0);
    }

    const subset = new EvaluationRunner().selectReferenceSubset(profile.id);
    expect(subset.references).toHaveLength(8);
    expect(subset.weakReferenceSet).toBe(false);
  });

  it("marks fewer than three references as a weak reference set", () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    db.prepare(
      `INSERT INTO reference_assets (id, style_profile_id, asset_type, file_path)
       VALUES (?, ?, 'card', 'assets/ref.png')`
    ).run(randomUUID(), profile.id);

    const subset = new EvaluationRunner().selectReferenceSubset(profile.id);
    expect(subset.references).toHaveLength(1);
    expect(subset.weakReferenceSet).toBe(true);
  });
});
