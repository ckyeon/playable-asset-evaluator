import { existsSync } from "node:fs";
import { assetAbsolutePath } from "@/lib/files/paths";
import { loadProfileContextReadModel, type ProfileContextReadModel } from "@/lib/services/profile-context-read-model";
import type {
  CandidateImage,
  GenerationContextAsset,
  ReferenceAsset,
  StyleProfile
} from "@/lib/types/domain";

interface ExportWarning {
  code: "missing_file";
  path: string;
  entity_id: string;
}

export class ExportBuilder {
  buildJson(styleProfileId: string): unknown {
    const data = this.loadProfileData(styleProfileId);
    return {
      exported_at: new Date().toISOString(),
      style_profile: data.profile,
      warnings: data.warnings,
      reference_assets: data.references.map(withFileWarningFlag(data.warnings)),
      contexts: data.model.contexts.map((context) => ({
        ...context.context,
        reference_strength: context.reference_strength,
        confidence_reasons: context.confidence_reasons,
        source_assets: context.sourceAssets.map(withFileWarningFlag(data.warnings)),
        candidates: context.candidates.map(({ candidate, evaluations }) => ({
          ...candidate,
          missing_file: hasWarning(data.warnings, candidate.id),
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
      reference_assets: Array<ReferenceAsset & { missing_file: boolean }>;
      contexts: Array<{
        id: string;
        name: string;
        generation_goal: string | null;
        source_prompt: string | null;
        reference_strength: string;
        confidence_reasons: string[];
        source_assets: Array<GenerationContextAsset & { missing_file: boolean }>;
        candidates: Array<CandidateImage & { missing_file: boolean; evaluations: Array<any> }>;
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
      for (const candidate of context.candidates) {
        lines.push(
          "",
          `### Candidate ${candidate.id}`,
          "",
          `- Image: ${candidate.file_path}${candidate.missing_file ? " (missing_file)" : ""}`,
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

  private loadProfileData(styleProfileId: string): {
    profile: StyleProfile;
    references: ReferenceAsset[];
    model: ProfileContextReadModel;
    warnings: ExportWarning[];
  } {
    const model = loadProfileContextReadModel(styleProfileId);
    const candidates = model.contexts.flatMap((context) => context.candidates.map((item) => item.candidate));
    const sourceAssets = model.contexts.flatMap((context) => context.sourceAssets);
    const warnings = [
      ...model.referenceAssets.flatMap(fileWarningFor),
      ...sourceAssets.flatMap(fileWarningFor),
      ...candidates.flatMap(fileWarningFor)
    ];

    return { profile: model.profile, references: model.referenceAssets, model, warnings };
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
