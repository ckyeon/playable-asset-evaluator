import { errorResponse, ok } from "@/lib/api/responses";
import { GenerationContextService } from "@/lib/services/generation-context-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      styleProfileId?: string;
      name?: string;
      sourceContext?: string;
    };
    if (!body.styleProfileId) {
      throw new Error("Style profile id is required.");
    }

    const generationContext = new GenerationContextService().createContext({
      styleProfileId: body.styleProfileId,
      name: body.name?.trim() || "Untitled evaluation session",
      generationGoal: body.sourceContext
    });

    return ok(
      {
        deprecated: true,
        session: {
          id: generationContext.id,
          style_profile_id: generationContext.style_profile_id,
          name: generationContext.name,
          source_context: generationContext.generation_goal,
          created_at: generationContext.created_at
        },
        generationContext
      },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
