import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { assetAbsolutePath, ensureDir, toDataRelativePath } from "@/lib/files/paths";
import { safeFileStem, validateImageLike } from "@/lib/files/image-validation";

export interface StoredImageFile {
  id: string;
  filePath: string;
  thumbnailPath: string | null;
  absoluteFilePath: string;
  absoluteThumbnailPath: string | null;
}

export class ImageFileStore {
  async writeImageFile(input: { file: File; directory: string }): Promise<StoredImageFile> {
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

  async cleanupFiles(paths: Array<string | null>): Promise<void> {
    await Promise.all(paths.filter(Boolean).map((filePath) => fs.rm(filePath as string, { force: true })));
  }

  async cleanupRelativeFiles(paths: Array<string | null>): Promise<void> {
    await Promise.all(
      paths.filter(Boolean).map((filePath) => fs.rm(assetAbsolutePath(filePath as string), { force: true }))
    );
  }
}
