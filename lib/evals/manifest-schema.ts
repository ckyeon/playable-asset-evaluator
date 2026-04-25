import { z } from "zod";
import { ASSET_TYPES, DECISION_LABELS } from "@/lib/domain/constants";

const assetTypeSchema = z.enum(ASSET_TYPES);
const decisionLabelSchema = z.enum(DECISION_LABELS);
const effectivenessSchema = z.enum(["improved", "flat", "regressed", "unknown"]);

const sourcePromptObjectSchema = z
  .object({
    text: z.string().trim().min(1)
  })
  .passthrough();

export const sourcePromptSchema = z.union([z.string().trim().min(1), sourcePromptObjectSchema]);

export const manifestSourceAssetSchema = z
  .object({
    id: z.string().trim().min(1),
    asset_type: assetTypeSchema.optional(),
    image_path: z.string().trim().min(1),
    note: z.string().trim().min(1).nullable().optional(),
    style_tags: z.array(z.string().trim().min(1)).optional()
  })
  .passthrough();

export const manifestCandidateSchema = z
  .object({
    id: z.string().trim().min(1),
    image_path: z.string().trim().min(1),
    expected_decision: decisionLabelSchema,
    human_reason: z.string().trim().min(1),
    prompt_missing: z.boolean(),
    recovery_note: z.string().trim().min(1).nullable().optional(),
    prompt_text: z.string().trim().min(1).nullable().optional(),
    prompt_revision_id: z.string().trim().min(1).nullable().optional(),
    fit_tags: z.array(z.string().trim().min(1)).optional(),
    risk_tags: z.array(z.string().trim().min(1)).optional()
  })
  .passthrough();

export const manifestPromptRevisionSchema = z
  .object({
    id: z.string().trim().min(1),
    parent_prompt_revision_id: z.string().trim().min(1).nullable().optional(),
    source_guidance_id: z.string().trim().min(1).nullable().optional(),
    revision_label: z.string().trim().min(1).nullable().optional(),
    revision_note: z.string().trim().min(1).nullable().optional(),
    prompt_text: z.string().trim().min(1),
    negative_prompt: z.string().trim().min(1).nullable().optional(),
    parameters_json: z.union([z.string().trim().min(1), z.record(z.unknown())]).nullable().optional(),
    expected_effectiveness: effectivenessSchema.optional()
  })
  .passthrough();

export const manifestContextSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    generation_goal: z.string().trim().min(1).nullable().optional(),
    asset_focus: assetTypeSchema.optional(),
    target_use: z.string().trim().min(1).nullable().optional(),
    source_prompt: sourcePromptSchema.nullable().optional(),
    prompt_revisions: z.array(manifestPromptRevisionSchema).optional(),
    source_assets: z.array(manifestSourceAssetSchema).min(1),
    candidates: z.array(manifestCandidateSchema).min(1)
  })
  .superRefine((value, context) => {
    const revisionIds = new Set<string>();
    for (const revision of value.prompt_revisions || []) {
      if (revisionIds.has(revision.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate prompt revision id: ${revision.id}`,
          path: ["prompt_revisions"]
        });
      }
      revisionIds.add(revision.id);
    }

    for (const revision of value.prompt_revisions || []) {
      if (revision.parent_prompt_revision_id && !revisionIds.has(revision.parent_prompt_revision_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown parent prompt revision id: ${revision.parent_prompt_revision_id}`,
          path: ["prompt_revisions"]
        });
      }
    }

    const sourceIds = new Set<string>();
    for (const asset of value.source_assets) {
      if (sourceIds.has(asset.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate source asset id: ${asset.id}`,
          path: ["source_assets"]
        });
      }
      sourceIds.add(asset.id);
    }

    const candidateIds = new Set<string>();
    for (const candidate of value.candidates) {
      if (candidateIds.has(candidate.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate candidate id: ${candidate.id}`,
          path: ["candidates"]
        });
      }
      candidateIds.add(candidate.id);
      if (candidate.prompt_revision_id && !revisionIds.has(candidate.prompt_revision_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown candidate prompt revision id: ${candidate.prompt_revision_id}`,
          path: ["candidates"]
        });
      }
    }
  });

export const evalManifestSchema = z
  .object({
    name: z.string().trim().min(1),
    status: z.string().trim().min(1),
    note: z.string().trim().min(1).optional(),
    asset_focus: assetTypeSchema,
    evaluation_goal: z.string().trim().min(1),
    contexts: z.array(manifestContextSchema).min(1)
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const item of value.contexts) {
      if (ids.has(item.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate context id: ${item.id}`,
          path: ["contexts"]
        });
      }
      ids.add(item.id);
    }
  });

export type EvalManifest = z.infer<typeof evalManifestSchema>;
export type EvalManifestContext = z.infer<typeof manifestContextSchema>;
export type EvalManifestSourceAsset = z.infer<typeof manifestSourceAssetSchema>;
export type EvalManifestCandidate = z.infer<typeof manifestCandidateSchema>;
export type EvalManifestPromptRevision = z.infer<typeof manifestPromptRevisionSchema>;

export function parseEvalManifest(raw: unknown): EvalManifest {
  return evalManifestSchema.parse(raw);
}

export function sourcePromptText(sourcePrompt: EvalManifestContext["source_prompt"]): string | null {
  if (!sourcePrompt) {
    return null;
  }
  return typeof sourcePrompt === "string" ? sourcePrompt : sourcePrompt.text;
}
