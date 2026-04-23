import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getDb } from "@/lib/db/client";
import {
  assetAbsolutePath,
  candidateAssetDir,
  ensureDir,
  profileAssetDir,
  toDataRelativePath
} from "@/lib/files/paths";
import { safeFileStem, validateImageLike } from "@/lib/files/image-validation";
import type { AssetType, CandidateImage, EvaluationSession, ReferenceAsset } from "@/lib/types/domain";

interface SaveReferenceInput {
  styleProfileId: string;
  file: File;
  assetType: AssetType;
  note?: string | null;
  pinned?: boolean;
}

interface SaveCandidateInput {
  sessionId: string;
  file: File;
  promptText?: string | null;
  promptMissing?: boolean;
  recoveryNote?: string | null;
  generationTool?: string | null;
}

export class AssetStorage {
  async saveReferenceAsset(input: SaveReferenceInput): Promise<ReferenceAsset> {
    const db = getDb();
    const profile = db
      .prepare("SELECT id FROM style_profiles WHERE id = ?")
      .get(input.styleProfileId) as { id: string } | undefined;

    if (!profile) {
      throw new Error("Style profile not found.");
    }

    const stored = await this.writeImageFile({
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
      await this.cleanupFiles([stored.absoluteFilePath, stored.absoluteThumbnailPath]);
      throw error;
    }
  }

  async saveCandidateImage(input: SaveCandidateInput): Promise<CandidateImage> {
    const db = getDb();
    const session = db
      .prepare("SELECT * FROM evaluation_sessions WHERE id = ?")
      .get(input.sessionId) as EvaluationSession | undefined;

    if (!session) {
      throw new Error("Evaluation session not found.");
    }

    const promptText = input.promptText?.trim() || null;
    const promptMissing = input.promptMissing || !promptText;
    const stored = await this.writeImageFile({
      file: input.file,
      directory: candidateAssetDir(session.style_profile_id, session.id)
    });

    try {
      db.prepare(
        `INSERT INTO candidate_images
          (id, session_id, file_path, thumbnail_path, generation_tool, prompt_text, prompt_missing, source_integrity, recovery_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        stored.id,
        input.sessionId,
        stored.filePath,
        stored.thumbnailPath,
        input.generationTool?.trim() || null,
        promptText,
        promptMissing ? 1 : 0,
        promptMissing ? "incomplete" : "complete",
        input.recoveryNote?.trim() || null
      );

      return db.prepare("SELECT * FROM candidate_images WHERE id = ?").get(stored.id) as CandidateImage;
    } catch (error) {
      await this.cleanupFiles([stored.absoluteFilePath, stored.absoluteThumbnailPath]);
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
    await this.cleanupRelativeFiles([asset.file_path, asset.thumbnail_path]);
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
    await this.cleanupRelativeFiles([candidate.file_path, candidate.thumbnail_path]);
  }

  private async writeImageFile(input: {
    file: File;
    directory: string;
  }): Promise<{
    id: string;
    filePath: string;
    thumbnailPath: string | null;
    absoluteFilePath: string;
    absoluteThumbnailPath: string | null;
  }> {
    const id = randomUUID();
    const validation = validateImageLike({
      name: input.file.name,
      type: input.file.type,
      size: input.file.size
    });
    const buffer = Buffer.from(await input.file.arrayBuffer());
    const stem = `${id}-${safeFileStem(input.file.name)}`;

    ensureDir(input.directory);

    const absoluteFilePath = path.join(input.directory, `${stem}.${validation.extension}`);
    const absoluteThumbnailPath = path.join(input.directory, "thumbnails", `${stem}.webp`);
    ensureDir(path.dirname(absoluteThumbnailPath));

    await fs.writeFile(absoluteFilePath, buffer);

    let thumbnailPath: string | null = null;
    try {
      await sharp(buffer)
        .rotate()
        .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(absoluteThumbnailPath);
      thumbnailPath = toDataRelativePath(absoluteThumbnailPath);
    } catch {
      await fs.rm(absoluteThumbnailPath, { force: true });
    }

    return {
      id,
      filePath: toDataRelativePath(absoluteFilePath),
      thumbnailPath,
      absoluteFilePath,
      absoluteThumbnailPath: thumbnailPath ? absoluteThumbnailPath : null
    };
  }

  private async cleanupFiles(paths: Array<string | null>): Promise<void> {
    await Promise.all(paths.filter(Boolean).map((filePath) => fs.rm(filePath as string, { force: true })));
  }

  private async cleanupRelativeFiles(paths: Array<string | null>): Promise<void> {
    await Promise.all(
      paths.filter(Boolean).map((filePath) => fs.rm(assetAbsolutePath(filePath as string), { force: true }))
    );
  }
}
