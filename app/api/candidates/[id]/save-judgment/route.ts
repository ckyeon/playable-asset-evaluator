import { JudgmentStore } from "@/lib/services/judgment-store";
import { errorResponse, ok } from "@/lib/api/responses";
import type { DecisionLabel } from "@/lib/types/domain";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      decisionLabel?: DecisionLabel;
      humanReason?: string;
      promptText?: string | null;
      promptMissing?: boolean;
      recoveryNote?: string | null;
      generationTool?: string | null;
      nextPromptGuidance?: string | null;
    };

    const result = new JudgmentStore().saveJudgment({
      candidateId: id,
      decisionLabel: body.decisionLabel || "needs_edit",
      humanReason: body.humanReason || "",
      promptText: body.promptText,
      promptMissing: body.promptMissing,
      recoveryNote: body.recoveryNote,
      generationTool: body.generationTool,
      nextPromptGuidance: body.nextPromptGuidance
    });

    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
