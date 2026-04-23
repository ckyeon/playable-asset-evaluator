import { AssetStorage } from "@/lib/services/asset-storage";
import { errorResponse, ok } from "@/lib/api/responses";
import { toAssetUrl } from "@/lib/files/paths";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("Candidate image file is required.");
    }

    const candidate = await new AssetStorage().saveCandidateImage({
      sessionId: id,
      file,
      promptText: formData.get("promptText") as string | null,
      promptMissing: formData.get("promptMissing") === "true",
      recoveryNote: formData.get("recoveryNote") as string | null,
      generationTool: formData.get("generationTool") as string | null
    });

    return ok(
      {
        candidate: {
          ...candidate,
          imageUrl: toAssetUrl(candidate.thumbnail_path || candidate.file_path),
          originalUrl: toAssetUrl(candidate.file_path)
        }
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
