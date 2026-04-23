import { errorResponse, ok } from "@/lib/api/responses";
import { GenerationContextService } from "@/lib/services/generation-context-service";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const preview = new GenerationContextService().getDeletePreview(id);
    return ok({ deletePreview: preview });
  } catch (error) {
    return errorResponse(error, 404);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await new GenerationContextService().deleteContext(id);
    return ok({ deleted: true });
  } catch (error) {
    return errorResponse(error, 404);
  }
}
