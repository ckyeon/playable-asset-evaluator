import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { parseEvalManifest } from "@/lib/evals/manifest-schema";
import manifest from "./manifest.json";

const datasetDir = path.join(process.cwd(), "tests/evals/ai-character-chat");
const allowedDecisions = new Set(["good", "needs_edit", "reject"]);
const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

describe("AI Character Chat character asset baseline", () => {
  it("is a ready human-labeled style-match dataset", async () => {
    const parsed = parseEvalManifest(manifest);
    const context = parsed.contexts[0];
    expect(parsed.name).toBe("AI Character Chat character asset baseline");
    expect(parsed.status).toBe("ready");
    expect(parsed.asset_focus).toBe("character");
    expect(parsed.evaluation_goal).toBe("style_match");
    expect(typeof context.source_prompt).toBe("object");
    expect(context.source_prompt && typeof context.source_prompt !== "string" ? context.source_prompt.language : null).toBe("ko");
    expect(context.source_prompt && typeof context.source_prompt !== "string" ? context.source_prompt.text : "").toContain(
      "캐릭터 이미지를 각 감정별로 생성해줘."
    );
    expect(
      context.source_prompt && typeof context.source_prompt !== "string" ? context.source_prompt.requested_emotions : []
    ).toHaveLength(8);
    expect(context.source_assets).toHaveLength(8);
    expect(context.candidates).toHaveLength(10);

    const labels = new Map<string, number>();
    for (const candidate of context.candidates) {
      labels.set(candidate.expected_decision, (labels.get(candidate.expected_decision) || 0) + 1);
    }
    expect(labels.get("good")).toBeGreaterThanOrEqual(2);
    expect(labels.get("needs_edit")).toBeGreaterThanOrEqual(3);
    expect(labels.get("reject")).toBeGreaterThanOrEqual(2);

    for (const sourceAsset of context.source_assets) {
      expect(sourceAsset.asset_type).toBe("character");
      expect((sourceAsset.note || "").length).toBeGreaterThan(40);
      expect(sourceAsset.style_tags?.length).toBeGreaterThanOrEqual(3);
      await expectValidImage(sourceAsset.image_path);
    }

    for (const candidate of context.candidates) {
      expect(allowedDecisions.has(candidate.expected_decision)).toBe(true);
      expect(candidate.human_reason.length).toBeGreaterThan(40);
      expect(candidate.fit_tags?.length).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(candidate.risk_tags)).toBe(true);
      expect(typeof candidate.prompt_missing).toBe("boolean");
      await expectValidImage(candidate.image_path);
    }
  });
});

async function expectValidImage(relativePath: string): Promise<void> {
  const absolutePath = path.join(datasetDir, relativePath);
  expect(existsSync(absolutePath), `${relativePath} should exist`).toBe(true);
  expect(allowedExtensions.has(path.extname(relativePath).toLowerCase())).toBe(true);

  const metadata = await sharp(absolutePath).metadata();
  expect(metadata.width).toBeGreaterThan(0);
  expect(metadata.height).toBeGreaterThan(0);
  expect(Math.max(metadata.width || 0, metadata.height || 0)).toBeLessThanOrEqual(1024);
}
