import { getDb } from "@/lib/db/client";
import { errorResponse, ok } from "@/lib/api/responses";
import { toAssetUrl } from "@/lib/files/paths";
import type { CandidateImage, Evaluation, EvaluationCriterion, EvaluationSession, PromptGuidance } from "@/lib/types/domain";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const db = getDb();
    const sessions = db
      .prepare("SELECT * FROM evaluation_sessions WHERE style_profile_id = ? ORDER BY created_at DESC")
      .all(id) as EvaluationSession[];
    const history = sessions.flatMap((session) => {
      const candidates = db
        .prepare("SELECT * FROM candidate_images WHERE session_id = ? ORDER BY created_at DESC")
        .all(session.id) as CandidateImage[];

      return candidates.map((candidate) => {
        const evaluations = db
          .prepare("SELECT * FROM evaluations WHERE candidate_image_id = ? ORDER BY created_at DESC")
          .all(candidate.id) as Evaluation[];
        return {
          session,
          candidate: {
            ...candidate,
            imageUrl: toAssetUrl(candidate.thumbnail_path || candidate.file_path),
            originalUrl: toAssetUrl(candidate.file_path)
          },
          evaluations: evaluations.map((evaluation) => ({
            ...evaluation,
            criteria: db
              .prepare("SELECT * FROM evaluation_criteria WHERE evaluation_id = ? ORDER BY criterion")
              .all(evaluation.id) as EvaluationCriterion[],
            prompt_guidance: db
              .prepare("SELECT * FROM prompt_guidance WHERE evaluation_id = ? ORDER BY created_at DESC")
              .all(evaluation.id) as PromptGuidance[]
          }))
        };
      });
    });

    return ok({ history });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
