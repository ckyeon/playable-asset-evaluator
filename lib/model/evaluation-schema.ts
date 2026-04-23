import { z } from "zod";
import { ALL_CRITERIA, CONFIDENCE_STATES, DECISION_LABELS, V2_CRITERIA } from "@/lib/domain/constants";

export const criterionSchema = z.enum(ALL_CRITERIA);

export const decisionLabelSchema = z.enum(DECISION_LABELS);

export const confidenceStateSchema = z.enum(CONFIDENCE_STATES);

export const modelEvaluationSchema = z
  .object({
    fit_score: z.number().int().min(0).max(100),
    criteria: z
      .array(
        z.object({
          criterion: criterionSchema,
          score: z.number().int().min(0).max(100),
          reason: z.string().min(1)
        })
      )
      .length(4),
    ai_summary: z.string().min(1),
    suggested_decision: decisionLabelSchema,
    next_prompt_guidance: z.string().min(1),
    confidence_state: confidenceStateSchema
  })
  .superRefine((value, context) => {
    const seen = new Set(value.criteria.map((criterion) => criterion.criterion));
    for (const required of V2_CRITERIA) {
      if (!seen.has(required)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing criterion: ${required}`,
          path: ["criteria"]
        });
      }
    }
  });

export type ModelEvaluationOutput = z.infer<typeof modelEvaluationSchema>;

export function parseModelEvaluation(raw: unknown): ModelEvaluationOutput {
  return modelEvaluationSchema.parse(raw);
}
