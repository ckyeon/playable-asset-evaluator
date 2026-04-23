import { errorResponse, ok } from "@/lib/api/responses";
import { GenerationContextService } from "@/lib/services/generation-context-service";
import type { AssetType } from "@/lib/types/domain";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      name?: string;
      generationGoal?: string | null;
      assetFocus?: AssetType;
      targetUse?: string | null;
      sourcePrompt?: string | null;
      toolName?: string | null;
      modelName?: string | null;
    };

    const generationContext = new GenerationContextService().createContext({
      styleProfileId: id,
      name: body.name,
      generationGoal: body.generationGoal,
      assetFocus: body.assetFocus,
      targetUse: body.targetUse,
      sourcePrompt: body.sourcePrompt,
      toolName: body.toolName,
      modelName: body.modelName
    });

    return ok({ generationContext }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
