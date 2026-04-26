import { errorResponse, ok } from "@/lib/api/responses";
import { PromptRevisionService } from "@/lib/services/prompt-revision-service";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      promptText?: string | null;
      parentPromptRevisionId?: string | null;
      sourceGuidanceId?: string | null;
      revisionLabel?: string | null;
      revisionNote?: string | null;
      negativePrompt?: string | null;
      parametersJson?: string | null;
    };

    const promptRevision = new PromptRevisionService().createRevision({
      generationContextId: id,
      parentPromptRevisionId: body.parentPromptRevisionId,
      sourceGuidanceId: body.sourceGuidanceId,
      revisionLabel: body.revisionLabel,
      revisionNote: body.revisionNote,
      promptText: body.promptText,
      negativePrompt: body.negativePrompt,
      parametersJson: body.parametersJson
    });

    return ok({ promptRevision }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
