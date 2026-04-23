import type { DecisionLabel } from "@/lib/types/domain";

export function manualFitScore(decisionLabel: DecisionLabel): number {
  if (decisionLabel === "good") {
    return 86;
  }
  if (decisionLabel === "needs_edit") {
    return 64;
  }
  return 28;
}
