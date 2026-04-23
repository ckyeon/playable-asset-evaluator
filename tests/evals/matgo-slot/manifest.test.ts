import { describe, expect, it } from "vitest";
import { parseEvalManifest } from "@/lib/evals/manifest-schema";
import manifest from "./manifest.json";

describe("Matgo -> Slot tiny eval manifest", () => {
  it("defines the v1 baseline shape", () => {
    const parsed = parseEvalManifest(manifest);
    const context = parsed.contexts[0];
    expect(parsed.status).toBe("placeholder_assets_pending");
    expect(context.source_assets).toHaveLength(8);
    expect(context.candidates).toHaveLength(10);
    expect(new Set(context.candidates.map((candidate) => candidate.expected_decision))).toEqual(
      new Set(["good", "needs_edit", "reject"])
    );
    expect(context.candidates.some((candidate) => candidate.prompt_missing)).toBe(true);
    for (const candidate of context.candidates) {
      expect(candidate.human_reason.length).toBeGreaterThan(20);
    }
  });
});
