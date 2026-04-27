import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { closeDbForTests } from "@/lib/db/client";

export function useTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "asset-evaluator-test-"));
  process.env.ASSET_EVALUATOR_DATA_DIR = dir;
  process.env.EVALUATION_ADAPTER = "mock";
  closeDbForTests();
  return dir;
}

export async function createImageFile(
  name: string,
  type: "image/png" | "image/jpeg" | "image/webp" = "image/png",
  color = "#d24b35"
): Promise<File> {
  const image = sharp({
    create: {
      width: 96,
      height: 96,
      channels: 4,
      background: color
    }
  });
  const buffer =
    type === "image/jpeg"
      ? await image.jpeg().toBuffer()
      : type === "image/webp"
        ? await image.webp().toBuffer()
        : await image.png().toBuffer();

  return new File([new Uint8Array(buffer)], name, { type });
}
