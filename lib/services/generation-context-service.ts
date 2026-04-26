import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { getDb } from "@/lib/db/client";
import { ImageFileStore } from "@/lib/files/image-file-store";
import { assetAbsolutePath, generationContextAssetDir } from "@/lib/files/paths";
import type {
  AssetType,
  CandidateImage,
  ConfidenceReasonCode,
  Evaluation,
  GenerationContext,
  GenerationContextAsset,
  ReferenceAsset,
  StyleProfile
} from "@/lib/types/domain";

const TEXT_CAPS = {
  sourcePrompt: 8000,
  note: 1000,
  generationGoal: 500,
  targetUse: 500
};

interface CreateContextInput {
  styleProfileId: string;
  name?: string | null;
  generationGoal?: string | null;
  assetFocus?: AssetType | null;
  targetUse?: string | null;
  sourcePrompt?: string | null;
  toolName?: string | null;
  modelName?: string | null;
}

interface UploadContextSourceInput {
  generationContextId: string;
  file: File;
  assetType: AssetType;
  note?: string | null;
}

export interface ContextConfidence {
  reference_strength: "none" | "weak" | "strong";
  confidence_reasons: ConfidenceReasonCode[];
}

export class GenerationContextService {
  constructor(private readonly fileStore = new ImageFileStore()) {}

  createContext(input: CreateContextInput): GenerationContext {
    const db = getDb();
    const profile = db
      .prepare("SELECT * FROM style_profiles WHERE id = ?")
      .get(input.styleProfileId) as StyleProfile | undefined;
    if (!profile) {
      throw new Error("Style profile not found.");
    }

    const id = randomUUID();
    const name = capped(input.name, 160) || "Untitled generation context";
    const generationGoal = capped(input.generationGoal, TEXT_CAPS.generationGoal);
    const targetUse = capped(input.targetUse, TEXT_CAPS.targetUse);
    const sourcePrompt = capped(input.sourcePrompt, TEXT_CAPS.sourcePrompt);

    db.transaction(() => {
      db.prepare(
        `INSERT INTO generation_contexts
          (id, style_profile_id, name, generation_goal, asset_focus, target_use, source_prompt, tool_name, model_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        profile.id,
        name,
        generationGoal,
        input.assetFocus || "other",
        targetUse,
        sourcePrompt,
        capped(input.toolName, 160),
        capped(input.modelName, 160)
      );

      this.touchProfile(profile.id);
    })();

    return db.prepare("SELECT * FROM generation_contexts WHERE id = ?").get(id) as GenerationContext;
  }

  addProfileReference(input: { generationContextId: string; referenceAssetId: string }): GenerationContextAsset {
    const db = getDb();
    const context = this.getContext(input.generationContextId);
    const reference = db
      .prepare("SELECT * FROM reference_assets WHERE id = ?")
      .get(input.referenceAssetId) as ReferenceAsset | undefined;
    if (!reference || reference.style_profile_id !== context.style_profile_id) {
      throw new Error("Reference asset not found for this style profile.");
    }

    const id = randomUUID();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO generation_context_assets
          (id, generation_context_id, reference_asset_id, origin, asset_type, file_path, thumbnail_path, sha256, byte_size, snapshot_note)
         VALUES (?, ?, ?, 'profile_reference', ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        context.id,
        reference.id,
        reference.asset_type,
        reference.file_path,
        reference.thumbnail_path,
        reference.sha256,
        reference.byte_size,
        reference.note
      );
      this.touchContext(context.id);
    })();

    return db.prepare("SELECT * FROM generation_context_assets WHERE id = ?").get(id) as GenerationContextAsset;
  }

  async uploadContextSourceAsset(input: UploadContextSourceInput): Promise<GenerationContextAsset> {
    const db = getDb();
    const context = this.getContext(input.generationContextId);
    const stored = await this.fileStore.writeImageFile({
      file: input.file,
      directory: generationContextAssetDir(context.style_profile_id, context.id, "sources")
    });

    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO generation_context_assets
            (id, generation_context_id, reference_asset_id, origin, asset_type, file_path, thumbnail_path, sha256, byte_size, snapshot_note)
           VALUES (?, ?, NULL, 'context_upload', ?, ?, ?, ?, ?, ?)`
        ).run(
          stored.id,
          context.id,
          input.assetType,
          stored.filePath,
          stored.thumbnailPath,
          stored.sha256,
          stored.byteSize,
          capped(input.note, TEXT_CAPS.note)
        );
        this.touchContext(context.id);
      })();

      return db.prepare("SELECT * FROM generation_context_assets WHERE id = ?").get(stored.id) as GenerationContextAsset;
    } catch (error) {
      await this.fileStore.cleanupFiles([stored.absoluteFilePath, stored.absoluteThumbnailPath]);
      throw error;
    }
  }

  getDeletePreview(generationContextId: string): {
    context: GenerationContext;
    candidate_count: number;
    evaluation_count: number;
    context_source_count: number;
  } {
    const db = getDb();
    const context = this.getContext(generationContextId);
    const candidateCount = db
      .prepare("SELECT COUNT(*) AS count FROM candidate_images WHERE generation_context_id = ?")
      .get(context.id) as { count: number };
    const evaluationCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM evaluations
         WHERE candidate_image_id IN (SELECT id FROM candidate_images WHERE generation_context_id = ?)`
      )
      .get(context.id) as { count: number };
    const contextSourceCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM generation_context_assets
         WHERE generation_context_id = ? AND origin = 'context_upload'`
      )
      .get(context.id) as { count: number };

    return {
      context,
      candidate_count: candidateCount.count,
      evaluation_count: evaluationCount.count,
      context_source_count: contextSourceCount.count
    };
  }

  async deleteContext(generationContextId: string): Promise<void> {
    const db = getDb();
    const context = this.getContext(generationContextId);
    const contextUploads = db
      .prepare(
        `SELECT file_path, thumbnail_path
         FROM generation_context_assets
         WHERE generation_context_id = ? AND origin = 'context_upload'`
      )
      .all(context.id) as Array<{ file_path: string; thumbnail_path: string | null }>;
    const candidates = db
      .prepare("SELECT * FROM candidate_images WHERE generation_context_id = ?")
      .all(context.id) as CandidateImage[];

    db.transaction(() => {
      db.prepare(
        `DELETE FROM prompt_guidance
         WHERE evaluation_id IN (
           SELECT evaluations.id
           FROM evaluations
           JOIN candidate_images ON candidate_images.id = evaluations.candidate_image_id
           WHERE candidate_images.generation_context_id = ?
         )`
      ).run(context.id);
      db.prepare("DELETE FROM generation_contexts WHERE id = ?").run(context.id);
      this.touchProfile(context.style_profile_id);
    })();

    await this.fileStore.cleanupRelativeFiles([
      ...contextUploads.flatMap((asset) => [asset.file_path, asset.thumbnail_path]),
      ...candidates.flatMap((candidate) => [candidate.file_path, candidate.thumbnail_path])
    ]);
  }

  touchContext(generationContextId: string): void {
    const db = getDb();
    const context = this.getContext(generationContextId);
    db.prepare(
      `UPDATE generation_contexts
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    ).run(context.id);
    this.touchProfile(context.style_profile_id);
  }

  private getContext(generationContextId: string): GenerationContext {
    const context = getDb()
      .prepare("SELECT * FROM generation_contexts WHERE id = ?")
      .get(generationContextId) as GenerationContext | undefined;
    if (!context) {
      throw new Error("Generation context not found.");
    }
    return context;
  }

  private touchProfile(styleProfileId: string): void {
    getDb()
      .prepare(
        `UPDATE style_profiles
         SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .run(styleProfileId);
  }
}

export function computeContextConfidence(
  context: GenerationContext,
  assets: GenerationContextAsset[],
  latestEvaluation?: Evaluation | null
): ContextConfidence {
  const reasons: ConfidenceReasonCode[] = [];
  const sourceCount = assets.length;

  if (!context.source_prompt?.trim()) {
    reasons.push("prompt_missing");
  }
  if (sourceCount < 3) {
    reasons.push("weak_source_assets");
  }
  if (assets.some((asset) => !existsSync(assetAbsolutePath(asset.file_path)))) {
    reasons.push("missing_source_file");
  }
  if (assets.some((asset) => !asset.snapshot_note?.trim())) {
    reasons.push("incomplete_source_metadata");
  }
  if (latestEvaluation?.evaluation_state === "failed") {
    reasons.push("model_failed");
  }

  return {
    reference_strength: sourceCount >= 3 && context.source_prompt?.trim() ? "strong" : sourceCount > 0 ? "weak" : "none",
    confidence_reasons: reasons
  };
}

function capped(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, max);
}
