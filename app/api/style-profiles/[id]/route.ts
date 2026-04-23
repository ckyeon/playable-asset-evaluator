import { getDb } from "@/lib/db/client";
import { errorResponse, ok } from "@/lib/api/responses";
import { toAssetUrl } from "@/lib/files/paths";
import type { CandidateImage, EvaluationSession, ReferenceAsset, StyleProfile } from "@/lib/types/domain";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const profile = db.prepare("SELECT * FROM style_profiles WHERE id = ?").get(id) as StyleProfile | undefined;
    if (!profile) {
      throw new Error("Style profile not found.");
    }

    const referenceAssets = db
      .prepare("SELECT * FROM reference_assets WHERE style_profile_id = ? ORDER BY pinned DESC, created_at DESC")
      .all(id) as ReferenceAsset[];
    const sessions = db
      .prepare("SELECT * FROM evaluation_sessions WHERE style_profile_id = ? ORDER BY created_at DESC")
      .all(id) as EvaluationSession[];
    const candidates = sessions.flatMap((session) =>
      db.prepare("SELECT * FROM candidate_images WHERE session_id = ? ORDER BY created_at DESC").all(session.id)
    ) as CandidateImage[];

    return ok({
      profile,
      referenceAssets: referenceAssets.map((asset) => ({
        ...asset,
        imageUrl: toAssetUrl(asset.thumbnail_path || asset.file_path)
      })),
      sessions,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        imageUrl: toAssetUrl(candidate.thumbnail_path || candidate.file_path),
        originalUrl: toAssetUrl(candidate.file_path)
      }))
    });
  } catch (error) {
    return errorResponse(error, 404);
  }
}
