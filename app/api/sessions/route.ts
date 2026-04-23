import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { errorResponse, ok } from "@/lib/api/responses";
import type { EvaluationSession } from "@/lib/types/domain";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      styleProfileId?: string;
      name?: string;
      sourceContext?: string;
    };
    if (!body.styleProfileId) {
      throw new Error("Style profile id is required.");
    }

    const id = randomUUID();
    const db = getDb();
    db.prepare("INSERT INTO evaluation_sessions (id, style_profile_id, name, source_context) VALUES (?, ?, ?, ?)")
      .run(id, body.styleProfileId, body.name?.trim() || "Untitled evaluation session", body.sourceContext?.trim() || null);

    return ok({ session: db.prepare("SELECT * FROM evaluation_sessions WHERE id = ?").get(id) as EvaluationSession }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
