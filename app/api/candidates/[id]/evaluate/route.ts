import { EvaluationRunner } from "@/lib/services/evaluation-runner";
import { errorResponse, ok } from "@/lib/api/responses";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { referenceIds?: string[] };
    const draft = await new EvaluationRunner().evaluateCandidate(id, body.referenceIds || []);
    return ok({ draft });
  } catch (error) {
    return errorResponse(error);
  }
}
