import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { manifestCandidateSchema, parseEvalManifest } from "@/lib/evals/manifest-schema";
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
      expect(candidate.expected_target_use_decision).toBe(candidate.expected_decision);
      expect(candidate.expected_quality_decision).toBe("good");
      expect(candidate.human_reason.length).toBeGreaterThan(40);
      expect(candidate.fit_tags?.length).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(candidate.risk_tags)).toBe(true);
      expect(typeof candidate.prompt_missing).toBe("boolean");
      await expectValidImage(candidate.image_path);
    }
  });

  it("validates future failed quality asset intake metadata", () => {
    expect(() =>
      manifestCandidateSchema.parse({
        id: "failed-01",
        image_path: "assets/candidates/failed-01.png",
        expected_decision: "good",
        expected_target_use_decision: "needs_edit",
        expected_quality_decision: "reject",
        human_reason: "This intentionally fails schema because target-use compatibility must mirror expected_decision.",
        prompt_missing: false,
        quality_failure_reason: "Face and hands are unusable.",
        next_prompt_guidance: "Regenerate with stable face and simpler hands."
      })
    ).toThrow();

    expect(() =>
      manifestCandidateSchema.parse({
        id: "failed-02",
        image_path: "assets/candidates/failed-02.png",
        expected_decision: "needs_edit",
        expected_target_use_decision: "needs_edit",
        expected_quality_decision: "needs_edit",
        human_reason: "This intentionally fails schema because failed quality assets need an explicit failure reason.",
        prompt_missing: false,
        next_prompt_guidance: "Regenerate with cleaner silhouette."
      })
    ).toThrow();

    expect(
      manifestCandidateSchema.parse({
        id: "failed-03",
        image_path: "assets/candidates/failed-03.png",
        expected_decision: "needs_edit",
        expected_target_use_decision: "needs_edit",
        expected_quality_decision: "reject",
        human_reason: "This records a future failed asset with enough metadata to separate target fit from quality.",
        prompt_missing: false,
        quality_failure_reason: "The character identity drifted too far to use.",
        usable_alternative_context: null,
        next_prompt_guidance: "Regenerate with the original face proportions and matching uniform."
      })
    ).toMatchObject({
      expected_quality_decision: "reject",
      quality_failure_reason: "The character identity drifted too far to use."
    });
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
