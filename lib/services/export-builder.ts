import { existsSync } from "node:fs";
import { getDb } from "@/lib/db/client";
import { assetAbsolutePath } from "@/lib/files/paths";
import type {
  CandidateImage,
  Evaluation,
  EvaluationCriterion,
  EvaluationSession,
  PromptGuidance,
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
      sessions: data.sessions.map((session) => ({
        ...session,
        candidates: data.candidates
          .filter((candidate) => candidate.session_id === session.id)
          .map((candidate) => ({
            ...candidate,
            missing_file: hasWarning(data.warnings, candidate.id),
            evaluations: data.evaluations
              .filter((evaluation) => evaluation.candidate_image_id === candidate.id)
              .map((evaluation) => ({
                ...evaluation,
                criteria: data.criteria.filter((criterion) => criterion.evaluation_id === evaluation.id),
                prompt_guidance: data.guidance.filter((guidance) => guidance.evaluation_id === evaluation.id)
              }))
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
      sessions: Array<
        EvaluationSession & {
          candidates: Array<
            CandidateImage & {
              missing_file: boolean;
              evaluations: Array<
                Evaluation & {
                  criteria: EvaluationCriterion[];
                  prompt_guidance: PromptGuidance[];
                }
              >;
            }
          >;
        }
      >;
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

    for (const session of data.sessions) {
      lines.push("", `## Session: ${session.name}`, "");
      for (const candidate of session.candidates) {
        lines.push(
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
    sessions: EvaluationSession[];
    candidates: CandidateImage[];
    evaluations: Evaluation[];
    criteria: EvaluationCriterion[];
    guidance: PromptGuidance[];
    warnings: ExportWarning[];
  } {
    const db = getDb();
    const profile = db.prepare("SELECT * FROM style_profiles WHERE id = ?").get(styleProfileId) as
      | StyleProfile
      | undefined;
    if (!profile) {
      throw new Error("Style profile not found.");
    }

    const references = db
      .prepare("SELECT * FROM reference_assets WHERE style_profile_id = ? ORDER BY created_at DESC")
      .all(styleProfileId) as ReferenceAsset[];
    const sessions = db
      .prepare("SELECT * FROM evaluation_sessions WHERE style_profile_id = ? ORDER BY created_at DESC")
      .all(styleProfileId) as EvaluationSession[];
    const candidates = sessions.flatMap((session) =>
      db
        .prepare("SELECT * FROM candidate_images WHERE session_id = ? ORDER BY created_at DESC")
        .all(session.id)
    ) as CandidateImage[];
    const evaluations = candidates.flatMap((candidate) =>
      db
        .prepare("SELECT * FROM evaluations WHERE candidate_image_id = ? ORDER BY created_at DESC")
        .all(candidate.id)
    ) as Evaluation[];
    const criteria = evaluations.flatMap((evaluation) =>
      db.prepare("SELECT * FROM evaluation_criteria WHERE evaluation_id = ? ORDER BY criterion").all(evaluation.id)
    ) as EvaluationCriterion[];
    const guidance = db
      .prepare("SELECT * FROM prompt_guidance WHERE style_profile_id = ? ORDER BY created_at DESC")
      .all(styleProfileId) as PromptGuidance[];
    const warnings = [
      ...references.flatMap(fileWarningFor),
      ...candidates.flatMap(fileWarningFor)
    ];

    return { profile, references, sessions, candidates, evaluations, criteria, guidance, warnings };
  }
}

function fileWarningFor(entity: ReferenceAsset | CandidateImage): ExportWarning[] {
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

function withFileWarningFlag(warnings: ExportWarning[]) {
  return (reference: ReferenceAsset): ReferenceAsset & { missing_file: boolean } => ({
    ...reference,
    missing_file: hasWarning(warnings, reference.id)
  });
}
