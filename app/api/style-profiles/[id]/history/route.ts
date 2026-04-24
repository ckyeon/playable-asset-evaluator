import { errorResponse, ok } from "@/lib/api/responses";
import { toAssetUrl } from "@/lib/files/paths";
import { loadProfileContextReadModel } from "@/lib/services/profile-context-read-model";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const data = loadProfileContextReadModel(id);
    const history = data.contexts.flatMap((context) =>
      context.candidates.map(({ candidate, evaluations }) => ({
        generationContext: {
          ...context.context,
          reference_strength: context.reference_strength,
          confidence_reasons: context.confidence_reasons
        },
        candidate: {
          ...candidate,
          imageUrl: toAssetUrl(candidate.thumbnail_path || candidate.file_path),
          originalUrl: toAssetUrl(candidate.file_path)
        },
        evaluations
      }))
    );

    return ok({ history });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
