import { AssetStorage } from "@/lib/services/asset-storage";
import { errorResponse, ok } from "@/lib/api/responses";
import { toAssetUrl } from "@/lib/files/paths";
import type { AssetType } from "@/lib/types/domain";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("Image file is required.");
    }

    const asset = await new AssetStorage().saveReferenceAsset({
      styleProfileId: id,
      file,
      assetType: ((formData.get("assetType") as string | null) || "other") as AssetType,
      note: formData.get("note") as string | null,
      pinned: formData.get("pinned") === "true"
    });

    return ok({ asset: { ...asset, imageUrl: toAssetUrl(asset.thumbnail_path || asset.file_path) } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
