import { ExportBuilder } from "@/lib/services/export-builder";
import { errorResponse } from "@/lib/api/responses";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json(new ExportBuilder().buildJson(id));
  } catch (error) {
    return errorResponse(error, 404);
  }
}
