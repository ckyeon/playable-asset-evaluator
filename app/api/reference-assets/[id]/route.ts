import { errorResponse, ok } from "@/lib/api/responses";
import { AssetStorage } from "@/lib/services/asset-storage";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await new AssetStorage().deleteReferenceAsset(id);
    return ok({ deleted: true });
  } catch (error) {
    return errorResponse(error, 404);
  }
}
