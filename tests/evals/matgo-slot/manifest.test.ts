import { describe, expect, it } from "vitest";
import manifest from "./manifest.json";

describe("Matgo -> Slot tiny eval manifest", () => {
  it("defines the v1 baseline shape", () => {
    expect(manifest.references).toHaveLength(8);
    expect(manifest.candidates).toHaveLength(10);
    expect(new Set(manifest.candidates.map((candidate) => candidate.expected_decision))).toEqual(
      new Set(["good", "needs_edit", "reject"])
    );
    expect(manifest.candidates.some((candidate) => candidate.prompt_missing)).toBe(true);
    for (const candidate of manifest.candidates) {
      expect(candidate.human_reason.length).toBeGreaterThan(20);
    }
  });
});
