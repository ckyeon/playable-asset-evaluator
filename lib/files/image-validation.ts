import path from "node:path";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"]
]);

const EXTENSION_TO_TYPE = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"]
]);

export interface ImageLike {
  name?: string;
  type?: string;
  size: number;
}

export function normalizeImageType(file: ImageLike): string {
  const explicitType = file.type?.toLowerCase().trim();
  if (explicitType) {
    return explicitType;
  }

  const ext = path.extname(file.name || "").toLowerCase();
  return EXTENSION_TO_TYPE.get(ext) || "application/octet-stream";
}

export function validateImageLike(file: ImageLike): { mimeType: string; extension: string } {
  const mimeType = normalizeImageType(file);

  if (mimeType === "image/svg+xml" || path.extname(file.name || "").toLowerCase() === ".svg") {
    throw new Error("SVG is unsupported in v1. Upload PNG, JPEG, or WebP.");
  }

  const extension = ALLOWED_IMAGE_TYPES.get(mimeType);
  if (!extension) {
    throw new Error("Unsupported image type. Upload PNG, JPEG, or WebP.");
  }

  if (file.size <= 0) {
    throw new Error("Image is empty.");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is larger than the 20MB v1 limit.");
  }

  return { mimeType, extension };
}

export function safeFileStem(name: string | undefined): string {
  const base = path.basename(name || "image", path.extname(name || "image"));
  return base.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "image";
}
