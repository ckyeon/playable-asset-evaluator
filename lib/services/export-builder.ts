import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { assetAbsolutePath } from "@/lib/files/paths";
import {
  loadProfileContextReadModel,
  type ProfileContextReadModel,
  type PromptRevisionReadModel
} from "@/lib/services/profile-context-read-model";
import type {
  CandidateImage,
  Evaluation,
  EvaluationCriterion,
  GenerationContextAsset,
  PromptGuidance,
  PromptRevision,
  ReferenceAsset,
  StyleProfile
} from "@/lib/types/domain";

interface ExportWarning {
  code: "missing_file";
  path: string;
  entity_id: string;
}

interface FileMetadata {
  missing_file: boolean;
  sha256?: string;
  byte_size?: number;
}

interface ProfileExportData {
  profile: StyleProfile;
  references: ReferenceAsset[];
  model: ProfileContextReadModel;
  warnings: ExportWarning[];
  fileMetadataCache: Map<string, FileMetadata>;
}

interface AgentDatasetItem {
  item_type: "single_candidate_evaluation";
  generation_context: {
    id: string;
    name: string;
    goal: string | null;
    asset_focus: string;
    source_prompt: string | null;
  };
  source_assets: Array<{
    id: string;
    origin: string;
    asset_type: string;
    file_path: string;
    snapshot_note: string | null;
  } & FileMetadata>;
  prompt_revision: PromptRevision | null;
  candidate: {
    id: string;
    file_path: string;
    prompt_missing: boolean;
    source_integrity: string;
    recovery_note: string | null;
  } & FileMetadata;
  evaluation: Pick<
    Evaluation,
    | "id"
    | "model_name"
    | "rubric_version"
    | "fit_score"
    | "decision_label"
    | "confidence_state"
    | "ai_summary"
    | "human_reason"
  > & { criteria: EvaluationCriterion[] };
  next_prompt_guidance: Pick<PromptGuidance, "id" | "guidance_text" | "confidence_state" | "created_at"> | null;
  provenance: {
    created_at: string;
    workspace_version: "local";
    missing_file: boolean;
  };
}

export class ExportBuilder {
  buildJson(styleProfileId: string): unknown {
    const data = this.loadProfileData(styleProfileId);
    return {
      exported_at: new Date().toISOString(),
      style_profile: data.profile,
      warnings: data.warnings,
      agent_dataset_items: this.buildAgentDatasetItems(data),
      reference_assets: data.references.map(withFileWarningFlag(data.warnings)),
      contexts: data.model.contexts.map((context) => ({
        ...context.context,
        reference_strength: context.reference_strength,
        confidence_reasons: context.confidence_reasons,
        source_assets: context.sourceAssets.map(withFileWarningFlag(data.warnings)),
        prompt_revisions: context.promptRevisions,
        candidates: context.candidates.map(({ candidate, promptRevision, evaluations }) => ({
          ...candidate,
          missing_file: hasWarning(data.warnings, candidate.id),
          prompt_revision: promptRevision,
          evaluations
        }))
      }))
    };
  }

  buildMarkdown(styleProfileId: string): string {
    const data = this.buildJson(styleProfileId) as {
      exported_at: string;
      style_profile: StyleProfile;
      warnings: ExportWarning[];
      agent_dataset_items: AgentDatasetItem[];
      reference_assets: Array<ReferenceAsset & { missing_file: boolean }>;
      contexts: Array<{
        id: string;
        name: string;
        generation_goal: string | null;
        source_prompt: string | null;
        reference_strength: string;
        confidence_reasons: string[];
        source_assets: Array<GenerationContextAsset & { missing_file: boolean }>;
        prompt_revisions: PromptRevisionReadModel[];
        candidates: Array<
          CandidateImage & {
            missing_file: boolean;
            prompt_revision: PromptRevisionReadModel | null;
            evaluations: Array<any>;
          }
        >;
      }>;
    };

    const lines = [
      `# ${data.style_profile.name}`,
      "",
      `Exported: ${data.exported_at}`,
      "",
      "## Style Summary",
      "",
      data.style_profile.style_summary || "No reusable style summary yet.",
      "",
      "## Reference Assets",
      ""
    ];

    for (const reference of data.reference_assets) {
      lines.push(
        `- ${reference.asset_type}: ${reference.file_path}${reference.missing_file ? " (missing_file)" : ""}${
          reference.note ? ` - ${reference.note}` : ""
        }`
      );
    }

    for (const context of data.contexts) {
      lines.push(
        "",
        `## Generation Context: ${context.name}`,
        "",
        `- Goal: ${context.generation_goal || "(none)"}`,
        `- Source prompt: ${context.source_prompt || "(none)"}`,
        `- Reference strength: ${context.reference_strength}`,
        `- Confidence reasons: ${context.confidence_reasons.length ? context.confidence_reasons.join(", ") : "(none)"}`,
        "",
        "### Source Assets",
        ""
      );
      for (const sourceAsset of context.source_assets) {
        lines.push(
          `- ${sourceAsset.origin}/${sourceAsset.asset_type}: ${sourceAsset.file_path}${
            sourceAsset.missing_file ? " (missing_file)" : ""
          }${sourceAsset.snapshot_note ? ` - ${sourceAsset.snapshot_note}` : ""}`
        );
      }
      lines.push("", "### Prompt Revisions", "");
      if (context.prompt_revisions.length === 0) {
        lines.push("- (none)");
      }
      for (const revision of context.prompt_revisions) {
        lines.push(
          `- ${revision.id}${revision.revision_label ? ` (${revision.revision_label})` : ""}: ${revision.effectiveness} (${revision.effectiveness_reason})`,
          `  - Parent: ${revision.parent_prompt_revision_id || "(root)"}`,
          `  - Source guidance: ${
            revision.sourceGuidance
              ? `${revision.sourceGuidance.id} - ${promptPreview(revision.sourceGuidance.guidance_text)}`
              : "(none)"
          }`,
          `  - Candidates: ${revision.candidate_count}`,
          `  - Prompt: ${promptPreview(revision.prompt_text)}`
        );
      }
      for (const candidate of context.candidates) {
        lines.push(
          "",
          `### Candidate ${candidate.id}`,
          "",
          `- Image: ${candidate.file_path}${candidate.missing_file ? " (missing_file)" : ""}`,
          `- Prompt revision: ${candidate.prompt_revision_id || "(none)"}`,
          `- Source integrity: ${candidate.source_integrity}`,
          `- Prompt missing: ${candidate.prompt_missing === 1 ? "yes" : "no"}`,
          `- Prompt: ${candidate.prompt_text || "(none)"}`,
          `- Recovery note: ${candidate.recovery_note || "(none)"}`,
          ""
        );

        for (const evaluation of candidate.evaluations) {
          lines.push(
            `- Decision: ${evaluation.decision_label}`,
            `- Fit score: ${evaluation.fit_score}`,
            `- Confidence: ${evaluation.confidence_state}`,
            `- Human reason: ${evaluation.human_reason || "(draft)"}`,
            `- AI summary: ${evaluation.ai_summary || "(none)"}`
          );
          for (const criterion of evaluation.criteria) {
            lines.push(`  - ${criterion.criterion}: ${criterion.score} - ${criterion.reason}`);
          }
          for (const guidance of evaluation.prompt_guidance) {
            lines.push(`  - Next prompt guidance: ${guidance.guidance_text}`);
          }
          lines.push("");
        }
      }
    }

    if (data.warnings.length > 0) {
      lines.push("## Warnings", "");
      for (const warning of data.warnings) {
        lines.push(`- ${warning.code}: ${warning.path}`);
      }
    }

    return `${lines.join("\n").trim()}\n`;
  }

  private loadProfileData(styleProfileId: string): ProfileExportData {
    const model = loadProfileContextReadModel(styleProfileId);
    const candidates = model.contexts.flatMap((context) => context.candidates.map((item) => item.candidate));
    const sourceAssets = model.contexts.flatMap((context) => context.sourceAssets);
    const warnings = [
      ...model.referenceAssets.flatMap(fileWarningFor),
      ...sourceAssets.flatMap(fileWarningFor),
      ...candidates.flatMap(fileWarningFor)
    ];

    return { profile: model.profile, references: model.referenceAssets, model, warnings, fileMetadataCache: new Map() };
  }

  private buildAgentDatasetItems(data: ProfileExportData): AgentDatasetItem[] {
    const items: AgentDatasetItem[] = [];

    for (const context of data.model.contexts) {
      const sourceAssets = context.sourceAssets.map((asset) => ({
        id: asset.id,
        origin: asset.origin,
        asset_type: asset.asset_type,
        file_path: asset.file_path,
        snapshot_note: asset.snapshot_note,
        ...fileMetadataForEntity(asset, data.fileMetadataCache)
      }));

      for (const { candidate, promptRevision, evaluations } of context.candidates) {
        const candidateMetadata = fileMetadataForEntity(candidate, data.fileMetadataCache);
        for (const evaluation of evaluations) {
          if (evaluation.evaluation_state !== "saved") {
            continue;
          }

          const latestGuidance = evaluation.prompt_guidance[0] || null;
          const missingFile = candidateMetadata.missing_file || sourceAssets.some((asset) => asset.missing_file);

          items.push({
            item_type: "single_candidate_evaluation",
            generation_context: {
              id: context.context.id,
              name: context.context.name,
              goal: context.context.generation_goal,
              asset_focus: context.context.asset_focus,
              source_prompt: context.context.source_prompt
            },
            source_assets: sourceAssets,
            prompt_revision: promptRevision ? stripRevisionReadModel(promptRevision) : null,
            candidate: {
              id: candidate.id,
              file_path: candidate.file_path,
              prompt_missing: candidate.prompt_missing === 1,
              source_integrity: candidate.source_integrity,
              recovery_note: candidate.recovery_note,
              ...candidateMetadata
            },
            evaluation: {
              id: evaluation.id,
              model_name: evaluation.model_name,
              rubric_version: evaluation.rubric_version,
              fit_score: evaluation.fit_score,
              decision_label: evaluation.decision_label,
              confidence_state: evaluation.confidence_state,
              ai_summary: evaluation.ai_summary,
              human_reason: evaluation.human_reason,
              criteria: evaluation.criteria
            },
            next_prompt_guidance: latestGuidance
              ? {
                  id: latestGuidance.id,
                  guidance_text: latestGuidance.guidance_text,
                  confidence_state: latestGuidance.confidence_state,
                  created_at: latestGuidance.created_at
                }
              : null,
            provenance: {
              created_at: evaluation.created_at,
              workspace_version: "local",
              missing_file: missingFile
            }
          });
        }
      }
    }

    return items;
  }
}

function fileWarningFor(entity: ReferenceAsset | GenerationContextAsset | CandidateImage): ExportWarning[] {
  const warnings: ExportWarning[] = [];
  for (const filePath of [entity.file_path, entity.thumbnail_path]) {
    if (filePath && !existsSync(assetAbsolutePath(filePath))) {
      warnings.push({ code: "missing_file", path: filePath, entity_id: entity.id });
    }
  }
  return warnings;
}

function hasWarning(warnings: ExportWarning[], entityId: string): boolean {
  return warnings.some((warning) => warning.entity_id === entityId);
}

function withFileWarningFlag<T extends { id: string }>(warnings: ExportWarning[]) {
  return (entity: T): T & { missing_file: boolean } => ({
    ...entity,
    missing_file: hasWarning(warnings, entity.id)
  });
}

function fileMetadataForPath(relativePath: string, cache: Map<string, FileMetadata>): FileMetadata {
  const cached = cache.get(relativePath);
  if (cached) {
    return cached;
  }

  let metadata: FileMetadata;
  try {
    const absolutePath = assetAbsolutePath(relativePath);
    if (!existsSync(absolutePath)) {
      metadata = { missing_file: true };
    } else {
      const stat = statSync(absolutePath);
      if (!stat.isFile()) {
        metadata = { missing_file: true };
      } else {
        metadata = {
          missing_file: false,
          sha256: createHash("sha256").update(readFileSync(absolutePath)).digest("hex"),
          byte_size: stat.size
        };
      }
    }
  } catch {
    metadata = { missing_file: true };
  }

  cache.set(relativePath, metadata);
  return metadata;
}

function fileMetadataForEntity(
  entity: Pick<ReferenceAsset | GenerationContextAsset | CandidateImage, "file_path" | "sha256" | "byte_size">,
  cache: Map<string, FileMetadata>
): FileMetadata {
  if (entity.sha256 && typeof entity.byte_size === "number") {
    return {
      missing_file: isMissingFilePath(entity.file_path),
      sha256: entity.sha256,
      byte_size: entity.byte_size
    };
  }

  return fileMetadataForPath(entity.file_path, cache);
}

function isMissingFilePath(relativePath: string): boolean {
  try {
    const absolutePath = assetAbsolutePath(relativePath);
    return !existsSync(absolutePath) || !statSync(absolutePath).isFile();
  } catch {
    return true;
  }
}

function stripRevisionReadModel(revision: PromptRevisionReadModel): PromptRevision {
  return {
    id: revision.id,
    generation_context_id: revision.generation_context_id,
    parent_prompt_revision_id: revision.parent_prompt_revision_id,
    source_guidance_id: revision.source_guidance_id,
    revision_label: revision.revision_label,
    revision_note: revision.revision_note,
    prompt_text: revision.prompt_text,
    negative_prompt: revision.negative_prompt,
    parameters_json: revision.parameters_json,
    created_at: revision.created_at,
    updated_at: revision.updated_at
  };
}

function promptPreview(promptText: string): string {
  const normalized = promptText.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}
