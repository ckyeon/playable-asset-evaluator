import { errorResponse, ok } from "@/lib/api/responses";
import { toAssetUrl } from "@/lib/files/paths";
import { AssetStorage } from "@/lib/services/asset-storage";
import { PromptRevisionService } from "@/lib/services/prompt-revision-service";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("Candidate image file is required.");
    }

    const promptText = formString(formData, "promptText");
    const promptRevisionId = formString(formData, "promptRevisionId");
    const submittedPromptMissing = formData.get("promptMissing") === "true";
    const promptRevision = new PromptRevisionService().resolveForCandidateUpload({
      generationContextId: id,
      promptRevisionId,
      parentPromptRevisionId: formString(formData, "parentPromptRevisionId"),
      sourceGuidanceId: formString(formData, "sourceGuidanceId"),
      revisionLabel: formString(formData, "revisionLabel"),
      revisionNote: formString(formData, "revisionNote"),
      promptText,
      negativePrompt: formString(formData, "negativePrompt"),
      parametersJson: formString(formData, "parametersJson"),
      promptMissing: submittedPromptMissing || (!promptRevisionId && !promptText?.trim())
    });
    const resolvedPromptText = promptRevision.promptText || promptText;
    const promptMissing = submittedPromptMissing || !resolvedPromptText?.trim();

    const candidate = await new AssetStorage().saveCandidateImage({
      generationContextId: id,
      file,
      promptRevisionId: promptRevision.promptRevisionId,
      promptText: resolvedPromptText,
      promptMissing,
      recoveryNote: formString(formData, "recoveryNote"),
      generationTool: formString(formData, "generationTool")
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

function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}
