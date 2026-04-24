import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function getDataDir(): string {
  return (
    process.env.ASSET_EVALUATOR_DATA_DIR?.trim() ||
    path.join(homedir(), "Library", "Application Support", "asset-evaluator")
  );
}

export function getDbPath(): string {
  return path.join(getDataDir(), "asset-evaluator.sqlite");
}

export function getAssetsDir(): string {
  return path.join(getDataDir(), "assets");
}

export function ensureBaseDirs(): void {
  for (const dir of [getDataDir(), getAssetsDir()]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function assetAbsolutePath(relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolute = path.join(getDataDir(), normalized);
  const root = getDataDir();
  if (!absolute.startsWith(root)) {
    throw new Error("Asset path escapes data directory");
  }
  return absolute;
}

export function toDataRelativePath(absolutePath: string): string {
  return path.relative(getDataDir(), absolutePath).split(path.sep).join("/");
}

export function toAssetUrl(relativePath: string | null): string | null {
  if (!relativePath) {
    return null;
  }

  return `/api/assets/${relativePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function profileAssetDir(profileId: string, kind: "references"): string {
  return path.join(getAssetsDir(), "profiles", profileId, kind);
}

export function generationContextAssetDir(profileId: string, contextId: string, kind: "sources" | "candidates"): string {
  return path.join(getAssetsDir(), "profiles", profileId, "generation-contexts", contextId, kind);
}
