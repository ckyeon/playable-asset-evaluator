import { z } from "zod";

export const criterionSchema = z.enum([
  "style_match",
  "playable_readability",
  "creative_appeal",
  "production_usability"
]);

export const decisionLabelSchema = z.enum(["good", "needs_edit", "reject"]);

export const confidenceStateSchema = z.enum(["normal", "low_confidence"]);

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
    for (const required of criterionSchema.options) {
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
