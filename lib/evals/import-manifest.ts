import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import { ImageFileStore, type StoredImageFile } from "@/lib/files/image-file-store";
import { profileAssetDir, generationContextAssetDir } from "@/lib/files/paths";
import { manualFitScore } from "@/lib/services/manual-fit-score";
import type { AssetType, ConfidenceState, DecisionLabel } from "@/lib/types/domain";
import {
  parseEvalManifest,
  sourcePromptText,
  type EvalManifest,
  type EvalManifestCandidate,
  type EvalManifestContext,
  type EvalManifestSourceAsset
} from "./manifest-schema";

const READY_STATUS = "ready";
const IMPORT_MODEL_NAME = "historical-import";

export interface EvalImportWarning {
  code: "prompt_missing_low_confidence" | "missing_recovery_note" | "non_ready_manifest";
  message: string;
  item_id?: string;
}

export interface EvalImportCounts {
  style_profiles: number;
  reference_assets: number;
  generation_contexts: number;
  generation_context_assets: number;
  candidate_images: number;
  evaluations: number;
}

export interface EvalImportResult {
  dataset_root: string;
  manifest_name: string;
  manifest_status: string;
  dry_run: boolean;
  status: "dry_run" | "imported" | "rejected";
  counts: EvalImportCounts;
  warnings: EvalImportWarning[];
  copied_files: string[];
  cleaned_files: string[];
  failed_item_path: string | null;
}

export class EvalManifestImportError extends Error {
  constructor(
    message: string,
    readonly result: EvalImportResult
  ) {
    super(message);
    this.name = "EvalManifestImportError";
  }
}

interface PlannedProfile {
  id: string;
  name: string;
  description: string | null;
}

interface PlannedContext {
  id: string;
  manifestId: string;
  name: string;
  generationGoal: string | null;
  assetFocus: AssetType;
  targetUse: string | null;
  sourcePrompt: string | null;
}

interface PlannedSourceAsset {
  referenceId: string;
  contextAssetId: string;
  manifestId: string;
  contextId: string;
  assetType: AssetType;
  note: string | null;
  relativeManifestPath: string;
  absoluteDatasetPath: string;
  staged?: StoredImageFile;
}

interface PlannedCandidate {
  id: string;
  evaluationId: string;
  manifestId: string;
  contextId: string;
  expectedDecision: DecisionLabel;
  humanReason: string;
  promptText: string | null;
  promptMissing: boolean;
  recoveryNote: string | null;
  confidenceState: ConfidenceState;
  sourceIntegrity: "complete" | "incomplete";
  relativeManifestPath: string;
  absoluteDatasetPath: string;
  staged?: StoredImageFile;
}

interface ImportPlan {
  datasetRoot: string;
  manifest: EvalManifest;
  profile: PlannedProfile;
  contexts: PlannedContext[];
  sourceAssets: PlannedSourceAsset[];
  candidates: PlannedCandidate[];
  warnings: EvalImportWarning[];
}

interface ImportOptions {
  dryRun?: boolean;
}

interface ImportDependencies {
  fileStore?: ImageFileStore;
  onBeforeCommit?: () => void;
}

export class EvalManifestImporter {
  private readonly fileStore: ImageFileStore;

  constructor(private readonly deps: ImportDependencies = {}) {
    this.fileStore = deps.fileStore || new ImageFileStore();
  }

  async importDataset(datasetRoot: string, options: ImportOptions = {}): Promise<EvalImportResult> {
    const dryRun = Boolean(options.dryRun);
    const root = path.resolve(datasetRoot);
    const result = emptyResult(root, dryRun);

    try {
      const manifestPath = path.join(root, "manifest.json");
      const manifest = parseEvalManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
      result.manifest_name = manifest.name;
      result.manifest_status = manifest.status;

      const plan = this.buildPlan(root, manifest);
      result.counts = plannedCounts(plan);
      result.warnings = plan.warnings;

      if (manifest.status !== READY_STATUS) {
        result.warnings = [
          ...result.warnings,
          {
            code: "non_ready_manifest",
            message: `Manifest status is '${manifest.status}'. Only '${READY_STATUS}' can be imported.`,
            item_id: undefined
          }
        ];
      }

      if (dryRun) {
        result.status = "dry_run";
        return result;
      }

      if (manifest.status !== READY_STATUS) {
        throw new EvalManifestImportError(`Manifest status '${manifest.status}' is not importable.`, {
          ...result,
          status: "rejected"
        });
      }

      await this.stageFiles(plan, result);
      this.commitPlan(plan);
      result.status = "imported";
      return result;
    } catch (error) {
      if (error instanceof EvalManifestImportError) {
        throw error;
      }

      result.status = "rejected";
      result.failed_item_path = findFailedItemPath(error) || result.failed_item_path;
      const cleaned = await this.cleanupStagedFiles(result.copied_files);
      result.cleaned_files = dedupe([...result.cleaned_files, ...cleaned]);
      throw new EvalManifestImportError(error instanceof Error ? error.message : "Eval manifest import failed.", result);
    }
  }

  private buildPlan(datasetRoot: string, manifest: EvalManifest): ImportPlan {
    const allowMissingFiles = manifest.status !== READY_STATUS;
    const profile: PlannedProfile = {
      id: randomUUID(),
      name: manifest.name,
      description: manifest.note?.trim() || null
    };
    const warnings: EvalImportWarning[] = [];

    const contexts = manifest.contexts.map((context) => ({
      id: randomUUID(),
      manifestId: context.id,
      name: context.name,
      generationGoal: context.generation_goal?.trim() || null,
      assetFocus: (context.asset_focus || manifest.asset_focus) as AssetType,
      targetUse: context.target_use?.trim() || null,
      sourcePrompt: sourcePromptText(context.source_prompt)?.trim() || null
    }));

    const sourceAssets = manifest.contexts.flatMap((context) => {
      const plannedContext = contexts.find((item) => item.manifestId === context.id);
      if (!plannedContext) {
        throw new Error(`Context plan not found for ${context.id}`);
      }
      return context.source_assets.map((asset) =>
        this.planSourceAsset(datasetRoot, manifest, context, plannedContext, asset, allowMissingFiles)
      );
    });

    const candidates = manifest.contexts.flatMap((context) => {
      const plannedContext = contexts.find((item) => item.manifestId === context.id);
      if (!plannedContext) {
        throw new Error(`Context plan not found for ${context.id}`);
      }
      return context.candidates.map((candidate) => {
        const promptMissing = candidate.prompt_missing;
        const recoveryNote = candidate.recovery_note?.trim() || null;
        if (promptMissing) {
          warnings.push({
            code: "prompt_missing_low_confidence",
            message: `Candidate '${candidate.id}' is imported as low confidence because the prompt is marked missing.`,
            item_id: candidate.id
          });
          if (!recoveryNote) {
            warnings.push({
              code: "missing_recovery_note",
              message: `Candidate '${candidate.id}' has prompt_missing=true without a recovery_note.`,
              item_id: candidate.id
            });
          }
        }

        return this.planCandidate(datasetRoot, context, plannedContext, candidate, allowMissingFiles);
      });
    });

    return {
      datasetRoot,
      manifest,
      profile,
      contexts,
      sourceAssets,
      candidates,
      warnings
    };
  }

  private planSourceAsset(
    datasetRoot: string,
    manifest: EvalManifest,
    context: EvalManifestContext,
    plannedContext: PlannedContext,
    asset: EvalManifestSourceAsset,
    allowMissingFiles: boolean
  ): PlannedSourceAsset {
    const absoluteDatasetPath = resolveDatasetAssetPath(datasetRoot, asset.image_path);
    return {
      referenceId: randomUUID(),
      contextAssetId: randomUUID(),
      manifestId: asset.id,
      contextId: plannedContext.id,
      assetType: (asset.asset_type || context.asset_focus || manifest.asset_focus) as AssetType,
      note: asset.note?.trim() || null,
      relativeManifestPath: asset.image_path,
      absoluteDatasetPath: allowMissingFiles ? absoluteDatasetPath : ensureDatasetFileExists(absoluteDatasetPath, asset.image_path)
    };
  }

  private planCandidate(
    datasetRoot: string,
    context: EvalManifestContext,
    plannedContext: PlannedContext,
    candidate: EvalManifestCandidate,
    allowMissingFiles: boolean
  ): PlannedCandidate {
    const promptMissing = candidate.prompt_missing;
    const recoveryNote = candidate.recovery_note?.trim() || null;
    const promptText = promptMissing
      ? null
      : candidate.prompt_text?.trim() || plannedContext.sourcePrompt || null;
    const absoluteDatasetPath = resolveDatasetAssetPath(datasetRoot, candidate.image_path);

    return {
      id: randomUUID(),
      evaluationId: randomUUID(),
      manifestId: candidate.id,
      contextId: plannedContext.id,
      expectedDecision: candidate.expected_decision,
      humanReason: candidate.human_reason.trim(),
      promptText,
      promptMissing,
      recoveryNote,
      confidenceState: promptMissing ? "low_confidence" : "normal",
      sourceIntegrity: promptMissing ? "incomplete" : "complete",
      relativeManifestPath: candidate.image_path,
      absoluteDatasetPath: allowMissingFiles
        ? absoluteDatasetPath
        : ensureDatasetFileExists(absoluteDatasetPath, candidate.image_path)
    };
  }

  private async stageFiles(plan: ImportPlan, result: EvalImportResult): Promise<void> {
    for (const asset of plan.sourceAssets) {
      asset.staged = await this.fileStore.importLocalImageFile({
        sourcePath: asset.absoluteDatasetPath,
        directory: profileAssetDir(plan.profile.id, "references"),
        preferredId: asset.referenceId
      });
      result.copied_files = dedupe([
        ...result.copied_files,
        asset.staged.filePath,
        ...(asset.staged.thumbnailPath ? [asset.staged.thumbnailPath] : [])
      ]);
    }

    for (const candidate of plan.candidates) {
      candidate.staged = await this.fileStore.importLocalImageFile({
        sourcePath: candidate.absoluteDatasetPath,
        directory: generationContextAssetDir(plan.profile.id, candidate.contextId, "candidates"),
        preferredId: candidate.id
      });
      result.copied_files = dedupe([
        ...result.copied_files,
        candidate.staged.filePath,
        ...(candidate.staged.thumbnailPath ? [candidate.staged.thumbnailPath] : [])
      ]);
    }
  }

  private commitPlan(plan: ImportPlan): void {
    const db = getDb();
    db.transaction(() => {
      this.deps.onBeforeCommit?.();

      db.prepare(
        `INSERT INTO style_profiles (id, name, description, style_summary)
         VALUES (?, ?, ?, NULL)`
      ).run(plan.profile.id, plan.profile.name, plan.profile.description);

      for (const context of plan.contexts) {
        db.prepare(
          `INSERT INTO generation_contexts
            (id, style_profile_id, name, generation_goal, asset_focus, target_use, source_prompt, tool_name, model_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
        ).run(
          context.id,
          plan.profile.id,
          context.name,
          context.generationGoal,
          context.assetFocus,
          context.targetUse,
          context.sourcePrompt
        );

        db.prepare(
          `INSERT INTO evaluation_sessions (id, style_profile_id, name, source_context)
           VALUES (?, ?, ?, ?)`
        ).run(context.id, plan.profile.id, context.name, context.generationGoal);
      }

      for (const asset of plan.sourceAssets) {
        if (!asset.staged) {
          throw withFailedItem(new Error("Source asset was not staged before commit."), asset.relativeManifestPath);
        }
        db.prepare(
          `INSERT INTO reference_assets
            (id, style_profile_id, asset_type, file_path, thumbnail_path, note, pinned)
           VALUES (?, ?, ?, ?, ?, ?, 0)`
        ).run(
          asset.referenceId,
          plan.profile.id,
          asset.assetType,
          asset.staged.filePath,
          asset.staged.thumbnailPath,
          asset.note
        );

        db.prepare(
          `INSERT INTO generation_context_assets
            (id, generation_context_id, reference_asset_id, origin, asset_type, file_path, thumbnail_path, snapshot_note)
           VALUES (?, ?, ?, 'profile_reference', ?, ?, ?, ?)`
        ).run(
          asset.contextAssetId,
          asset.contextId,
          asset.referenceId,
          asset.assetType,
          asset.staged.filePath,
          asset.staged.thumbnailPath,
          asset.note
        );
      }

      for (const candidate of plan.candidates) {
        if (!candidate.staged) {
          throw withFailedItem(new Error("Candidate image was not staged before commit."), candidate.relativeManifestPath);
        }

        db.prepare(
          `INSERT INTO candidate_images
            (id, generation_context_id, file_path, thumbnail_path, generation_tool, prompt_text, prompt_missing, source_integrity, recovery_note)
           VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`
        ).run(
          candidate.id,
          candidate.contextId,
          candidate.staged.filePath,
          candidate.staged.thumbnailPath,
          candidate.promptText,
          candidate.promptMissing ? 1 : 0,
          candidate.sourceIntegrity,
          candidate.recoveryNote
        );

        db.prepare(
          `INSERT INTO evaluations
            (id, candidate_image_id, model_name, fit_score, decision_label, human_reason, ai_summary, raw_model_output_json, confidence_state, evaluation_state, rubric_version)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'saved', 'v2_generation_context')`
        ).run(
          candidate.evaluationId,
          candidate.id,
          IMPORT_MODEL_NAME,
          manualFitScore(candidate.expectedDecision),
          candidate.expectedDecision,
          candidate.humanReason,
          JSON.stringify({
            imported_from_manifest: true,
            candidate_manifest_id: candidate.manifestId
          }),
          candidate.confidenceState
        );
      }
    })();
  }

  private async cleanupStagedFiles(copiedFiles: string[]): Promise<string[]> {
    if (copiedFiles.length === 0) {
      return [];
    }
    await this.fileStore.cleanupRelativeFiles(copiedFiles);
    return copiedFiles;
  }
}

function plannedCounts(plan: ImportPlan): EvalImportCounts {
  return {
    style_profiles: 1,
    reference_assets: plan.sourceAssets.length,
    generation_contexts: plan.contexts.length,
    generation_context_assets: plan.sourceAssets.length,
    candidate_images: plan.candidates.length,
    evaluations: plan.candidates.length
  };
}

function emptyResult(datasetRoot: string, dryRun: boolean): EvalImportResult {
  return {
    dataset_root: datasetRoot,
    manifest_name: "",
    manifest_status: "",
    dry_run: dryRun,
    status: "rejected",
    counts: {
      style_profiles: 0,
      reference_assets: 0,
      generation_contexts: 0,
      generation_context_assets: 0,
      candidate_images: 0,
      evaluations: 0
    },
    warnings: [],
    copied_files: [],
    cleaned_files: [],
    failed_item_path: null
  };
}

function resolveDatasetAssetPath(datasetRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw withFailedItem(new Error("Absolute image paths are not allowed in eval manifests."), relativePath);
  }

  const normalizedRoot = path.resolve(datasetRoot);
  const resolved = path.resolve(normalizedRoot, relativePath);
  const relative = path.relative(normalizedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw withFailedItem(new Error("Eval manifest image path escapes the dataset root."), relativePath);
  }
  return resolved;
}

function ensureDatasetFileExists(absolutePath: string, relativePath: string): string {
  if (!existsSync(absolutePath)) {
    throw withFailedItem(new Error("Eval manifest image path does not exist."), relativePath);
  }
  return absolutePath;
}

function findFailedItemPath(error: unknown): string | null {
  if (error instanceof Error && "failedItemPath" in error) {
    const failedItemPath = (error as Error & { failedItemPath?: string }).failedItemPath;
    return failedItemPath || null;
  }
  return null;
}

function withFailedItem(error: Error, failedItemPath: string): Error & { failedItemPath: string } {
  return Object.assign(error, { failedItemPath });
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
