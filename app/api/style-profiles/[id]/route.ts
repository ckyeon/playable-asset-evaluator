import { errorResponse, ok } from "@/lib/api/responses";
import { toAssetUrl } from "@/lib/files/paths";
import { loadProfileContextReadModel } from "@/lib/services/profile-context-read-model";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const data = loadProfileContextReadModel(id);

    return ok({
      profile: data.profile,
      referenceAssets: data.referenceAssets.map((asset) => ({
        ...asset,
        imageUrl: toAssetUrl(asset.thumbnail_path || asset.file_path)
      })),
      generationContexts: data.contexts.map((context) => ({
        ...context.context,
        sourceAssets: context.sourceAssets.map((asset) => ({
          ...asset,
          imageUrl: toAssetUrl(asset.thumbnail_path || asset.file_path)
        })),
        reference_strength: context.reference_strength,
        confidence_reasons: context.confidence_reasons,
        candidate_count: context.candidates.length,
        saved_judgment_count: context.candidates.flatMap((candidate) =>
          candidate.evaluations.filter((evaluation) => evaluation.evaluation_state === "saved")
        ).length
      })),
      sessions: data.contexts.map((context) => ({
        id: context.context.id,
        style_profile_id: context.context.style_profile_id,
        name: context.context.name,
        source_context: context.context.generation_goal,
        created_at: context.context.created_at
      })),
      candidates: data.contexts.flatMap((context) =>
        context.candidates.map(({ candidate }) => ({
          ...candidate,
          imageUrl: toAssetUrl(candidate.thumbnail_path || candidate.file_path),
          originalUrl: toAssetUrl(candidate.file_path)
        }))
      )
    });
  } catch (error) {
    return errorResponse(error, 404);
  }
}
