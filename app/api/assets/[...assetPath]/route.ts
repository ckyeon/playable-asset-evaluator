import { promises as fs } from "node:fs";
import path from "node:path";
import { assetAbsolutePath } from "@/lib/files/paths";

export const runtime = "nodejs";

const MIME_BY_EXT = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

export async function GET(_request: Request, context: { params: Promise<{ assetPath: string[] }> }) {
  const { assetPath } = await context.params;
  const relativePath = assetPath.join("/");
  const absolutePath = assetAbsolutePath(relativePath);
  const file = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();

  return new Response(file, {
    headers: {
      "content-type": MIME_BY_EXT.get(ext) || "application/octet-stream",
      "cache-control": "private, max-age=3600"
    }
  });
}
