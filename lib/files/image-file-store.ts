import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { assetAbsolutePath, ensureDir, toDataRelativePath } from "@/lib/files/paths";
import { safeFileStem, validateImageLike } from "@/lib/files/image-validation";

export interface StoredImageFile {
  id: string;
  filePath: string;
  thumbnailPath: string | null;
  sha256: string;
  byteSize: number;
  absoluteFilePath: string;
  absoluteThumbnailPath: string | null;
}

export class ImageFileStore {
  async writeImageFile(input: { file: File; directory: string }): Promise<StoredImageFile> {
    return this.writeBufferImage({
      buffer: Buffer.from(await input.file.arrayBuffer()),
      name: input.file.name,
      type: input.file.type,
      size: input.file.size,
      directory: input.directory
    });
  }

  async importLocalImageFile(input: {
    sourcePath: string;
    directory: string;
    preferredId?: string;
  }): Promise<StoredImageFile> {
    const stat = await fs.stat(input.sourcePath);
    return this.writeBufferImage({
      buffer: await fs.readFile(input.sourcePath),
      name: path.basename(input.sourcePath),
      size: stat.size,
      directory: input.directory,
      preferredId: input.preferredId
    });
  }

  async cleanupFiles(paths: Array<string | null>): Promise<void> {
    await Promise.all(paths.filter(Boolean).map((filePath) => fs.rm(filePath as string, { force: true })));
  }

  async cleanupRelativeFiles(paths: Array<string | null>): Promise<void> {
    await Promise.all(
      paths.filter(Boolean).map((filePath) => fs.rm(assetAbsolutePath(filePath as string), { force: true }))
    );
  }

  private async writeBufferImage(input: {
    buffer: Buffer;
    name: string;
    type?: string;
    size: number;
    directory: string;
    preferredId?: string;
  }): Promise<StoredImageFile> {
    const id = input.preferredId || randomUUID();
    const byteSize = input.buffer.byteLength;
    const sha256 = createHash("sha256").update(input.buffer).digest("hex");
    const validation = validateImageLike({
      name: input.name,
      type: input.type,
      size: input.size
    });
    const stem = `${id}-${safeFileStem(input.name)}`;

    ensureDir(input.directory);

    const absoluteFilePath = path.join(input.directory, `${stem}.${validation.extension}`);
    const absoluteThumbnailPath = path.join(input.directory, "thumbnails", `${stem}.webp`);
    ensureDir(path.dirname(absoluteThumbnailPath));

    await fs.writeFile(absoluteFilePath, input.buffer);

    let thumbnailPath: string | null = null;
    try {
      await sharp(input.buffer)
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
      sha256,
      byteSize,
      absoluteFilePath,
      absoluteThumbnailPath: thumbnailPath ? absoluteThumbnailPath : null
    };
  }
}
