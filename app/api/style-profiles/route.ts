import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { errorResponse, ok } from "@/lib/api/responses";
import { GenerationContextService } from "@/lib/services/generation-context-service";
import type { StyleProfile } from "@/lib/types/domain";

export const runtime = "nodejs";

export async function GET() {
  try {
    const profiles = getDb()
      .prepare("SELECT * FROM style_profiles ORDER BY updated_at DESC, created_at DESC")
      .all() as StyleProfile[];
    return ok({ profiles });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: string; description?: string };
    const name = body.name?.trim();
    if (!name) {
      throw new Error("Profile name is required.");
    }

    const id = randomUUID();
    const db = getDb();
    db.prepare("INSERT INTO style_profiles (id, name, description, style_summary) VALUES (?, ?, ?, ?)")
      .run(id, name, body.description?.trim() || null, "");
    new GenerationContextService().createContext({
      styleProfileId: id,
      name: "Default generation context",
      generationGoal: null
    });

    return ok({ profile: db.prepare("SELECT * FROM style_profiles WHERE id = ?").get(id) as StyleProfile }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
