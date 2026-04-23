import { errorResponse, ok } from "@/lib/api/responses";
import { toAssetUrl } from "@/lib/files/paths";
import { GenerationContextService } from "@/lib/services/generation-context-service";
import type { AssetType } from "@/lib/types/domain";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const contentType = request.headers.get("content-type") || "";
    const service = new GenerationContextService();

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        throw new Error("Source asset image file is required.");
      }
      const asset = await service.uploadContextSourceAsset({
        generationContextId: id,
        file,
        assetType: ((formData.get("assetType") as string | null) || "other") as AssetType,
        note: formData.get("note") as string | null
      });

      return ok({ asset: withUrl(asset) }, { status: 201 });
    }

    const body = (await request.json()) as { referenceAssetId?: string };
    if (!body.referenceAssetId) {
      throw new Error("Reference asset id is required.");
    }

    const asset = service.addProfileReference({
      generationContextId: id,
      referenceAssetId: body.referenceAssetId
    });
    return ok({ asset: withUrl(asset) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function withUrl<T extends { file_path: string; thumbnail_path: string | null }>(asset: T): T & { imageUrl: string | null } {
  return {
    ...asset,
    imageUrl: toAssetUrl(asset.thumbnail_path || asset.file_path)
  };
}
