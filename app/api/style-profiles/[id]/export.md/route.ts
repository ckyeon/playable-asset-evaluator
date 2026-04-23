import { ExportBuilder } from "@/lib/services/export-builder";
import { errorResponse } from "@/lib/api/responses";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return new Response(new ExportBuilder().buildMarkdown(id), {
      headers: {
        "content-type": "text/markdown; charset=utf-8"
      }
    });
  } catch (error) {
    return errorResponse(error, 404);
  }
}
