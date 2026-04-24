import { getDb } from "@/lib/db/client";
import { ImageFileStore } from "@/lib/files/image-file-store";
import { generationContextAssetDir, profileAssetDir } from "@/lib/files/paths";
import type { AssetType, CandidateImage, GenerationContext, ReferenceAsset } from "@/lib/types/domain";

interface SaveReferenceInput {
  styleProfileId: string;
  file: File;
  assetType: AssetType;
  note?: string | null;
  pinned?: boolean;
}

interface SaveCandidateInput {
  generationContextId: string;
  file: File;
  promptText?: string | null;
  promptMissing?: boolean;
  recoveryNote?: string | null;
  generationTool?: string | null;
}

export class AssetStorage {
  constructor(private readonly fileStore = new ImageFileStore()) {}

  async saveReferenceAsset(input: SaveReferenceInput): Promise<ReferenceAsset> {
    const db = getDb();
    const profile = db
      .prepare("SELECT id FROM style_profiles WHERE id = ?")
      .get(input.styleProfileId) as { id: string } | undefined;

    if (!profile) {
      throw new Error("Style profile not found.");
    }

    const stored = await this.fileStore.writeImageFile({
      file: input.file,
      directory: profileAssetDir(input.styleProfileId, "references")
    });

    try {
      db.prepare(
        `INSERT INTO reference_assets
          (id, style_profile_id, asset_type, file_path, thumbnail_path, note, pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        stored.id,
        input.styleProfileId,
        input.assetType,
        stored.filePath,
        stored.thumbnailPath,
        input.note?.trim() || null,
        input.pinned ? 1 : 0
      );

      return db.prepare("SELECT * FROM reference_assets WHERE id = ?").get(stored.id) as ReferenceAsset;
    } catch (error) {
      await this.fileStore.cleanupFiles([stored.absoluteFilePath, stored.absoluteThumbnailPath]);
      throw error;
    }
  }

  async saveCandidateImage(input: SaveCandidateInput): Promise<CandidateImage> {
    const db = getDb();
    if (!input.generationContextId) {
      throw new Error("Generation context id is required.");
    }

    const context = db
      .prepare("SELECT * FROM generation_contexts WHERE id = ?")
      .get(input.generationContextId) as GenerationContext | undefined;

    if (!context) {
      throw new Error("Generation context not found.");
    }

    const promptText = input.promptText?.trim() || null;
    const promptMissing = input.promptMissing || !promptText;
    const stored = await this.fileStore.writeImageFile({
      file: input.file,
      directory: generationContextAssetDir(context.style_profile_id, context.id, "candidates")
    });

    try {
      db.prepare(
        `INSERT INTO candidate_images
          (id, generation_context_id, file_path, thumbnail_path, generation_tool, prompt_text, prompt_missing, source_integrity, recovery_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        stored.id,
        context.id,
        stored.filePath,
        stored.thumbnailPath,
        input.generationTool?.trim() || null,
        promptText,
        promptMissing ? 1 : 0,
        promptMissing ? "incomplete" : "complete",
        input.recoveryNote?.trim() || null
      );

      db.prepare(
        `UPDATE generation_contexts
         SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      ).run(context.id);

      return db.prepare("SELECT * FROM candidate_images WHERE id = ?").get(stored.id) as CandidateImage;
    } catch (error) {
      await this.fileStore.cleanupFiles([stored.absoluteFilePath, stored.absoluteThumbnailPath]);
      throw error;
    }
  }

  async deleteReferenceAsset(referenceAssetId: string): Promise<void> {
    const db = getDb();
    const asset = db
      .prepare("SELECT * FROM reference_assets WHERE id = ?")
      .get(referenceAssetId) as ReferenceAsset | undefined;

    if (!asset) {
      throw new Error("Reference asset not found.");
    }

    db.prepare("DELETE FROM reference_assets WHERE id = ?").run(referenceAssetId);
    await this.fileStore.cleanupRelativeFiles([asset.file_path, asset.thumbnail_path]);
  }

  async deleteCandidateImage(candidateImageId: string): Promise<void> {
    const db = getDb();
    const candidate = db
      .prepare("SELECT * FROM candidate_images WHERE id = ?")
      .get(candidateImageId) as CandidateImage | undefined;

    if (!candidate) {
      throw new Error("Candidate image not found.");
    }

    const deleteRows = db.transaction(() => {
      db.prepare(
        `DELETE FROM prompt_guidance
         WHERE evaluation_id IN (
           SELECT id FROM evaluations WHERE candidate_image_id = ?
         )`
      ).run(candidateImageId);
      db.prepare("DELETE FROM candidate_images WHERE id = ?").run(candidateImageId);
    });

    deleteRows();
    await this.fileStore.cleanupRelativeFiles([candidate.file_path, candidate.thumbnail_path]);
  }
}
