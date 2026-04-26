import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { closeDbForTests, getDb } from "@/lib/db/client";
import { EvalManifestImporter } from "@/lib/evals/import-manifest";
import { EvaluationRunner } from "@/lib/services/evaluation-runner";
import type { DecisionLabel } from "@/lib/types/domain";

type Provider = "gemini" | "codex";

const DEFAULT_LIVE_EVAL_CONCURRENCY = 5;
const DEFAULT_LIVE_EVAL_TIMEOUT_MS = 240_000;

export interface LiveEvalArgs {
  provider: Provider;
  datasetRoot: string;
  keepData: boolean;
  concurrency: number;
  timeoutMs: number;
}

export interface LiveEvalSummary {
  total: number;
  completed: number;
  failures: number;
  target_matches: number;
  target_misses: number;
  quality_matches: number;
  quality_misses: number;
}

interface LiveEvalCandidate {
  id: string;
  prompt_text: string | null;
  expected_decision: DecisionLabel;
  raw_model_output_json: string | null;
}

export interface ExpectedLiveEvalDecisions {
  targetUseDecision: DecisionLabel;
  qualityDecision: DecisionLabel | null;
}

export interface ActualLiveEvalDecisions {
  targetUseDecision: DecisionLabel;
  qualityDecision: DecisionLabel | null;
}

async function main(): Promise<void> {
  const args = parseLiveEvalArgs(process.argv.slice(2));
  const dataDir = mkdtempSync(path.join(tmpdir(), `asset-evaluator-live-${args.provider}-`));
  process.env.ASSET_EVALUATOR_DATA_DIR = dataDir;
  process.env.EVALUATION_ADAPTER = "local-cli";
  process.env.EVALUATOR_PROVIDER = args.provider;
  process.env.EVALUATOR_TIMEOUT_MS = String(args.timeoutMs);

  try {
    await new EvalManifestImporter().importDataset(args.datasetRoot);
    const db = getDb();
    const candidates = db
      .prepare(
        `SELECT c.id, c.prompt_text, e.decision_label AS expected_decision, e.raw_model_output_json
         FROM candidate_images c
         JOIN evaluations e ON e.candidate_image_id = c.id AND e.evaluation_state = 'saved'
         ORDER BY c.created_at ASC`
      )
      .all() as LiveEvalCandidate[];

    const summary: LiveEvalSummary = {
      total: candidates.length,
      completed: 0,
      failures: 0,
      target_matches: 0,
      target_misses: 0,
      quality_matches: 0,
      quality_misses: 0
    };
    console.log(`Live evaluator: ${args.provider}`);
    console.log(`Dataset: ${args.datasetRoot}`);
    console.log(`Candidates: ${candidates.length}`);
    console.log(`Concurrency: ${args.concurrency}`);
    console.log(`Timeout: ${args.timeoutMs}ms`);

    await evaluateCandidates(candidates, args.concurrency, summary);

    console.log(
      `Summary: completed=${summary.completed}/${summary.total}, failures=${summary.failures}, target_matches=${summary.target_matches}, target_misses=${summary.target_misses}, quality_matches=${summary.quality_matches}, quality_misses=${summary.quality_misses}.`
    );
    const gateFailures = liveEvalGateFailures(summary);
    if (gateFailures.length > 0) {
      console.log(`Regression gate failed: ${gateFailures.join(", ")}.`);
      process.exitCode = 1;
    } else {
      console.log("Regression gate passed: no CLI failures or target/quality label mismatches.");
    }
  } finally {
    closeDbForTests();
    if (args.keepData) {
      console.log(`Kept live eval data dir: ${dataDir}`);
    } else {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
}

export function liveEvalGateFailures(
  summary: Pick<LiveEvalSummary, "failures" | "target_misses" | "quality_misses">
): string[] {
  const failures: string[] = [];
  if (summary.failures > 0) {
    failures.push(`cli_failures=${summary.failures}`);
  }
  if (summary.target_misses > 0) {
    failures.push(`target_use_misses=${summary.target_misses}`);
  }
  if (summary.quality_misses > 0) {
    failures.push(`asset_quality_misses=${summary.quality_misses}`);
  }
  return failures;
}

export function shouldFailLiveEval(
  summary: Pick<LiveEvalSummary, "failures" | "target_misses" | "quality_misses">
): boolean {
  return liveEvalGateFailures(summary).length > 0;
}

async function evaluateCandidates(
  candidates: LiveEvalCandidate[],
  concurrency: number,
  summary: LiveEvalSummary
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, candidates.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        const candidate = candidates[index];
        if (!candidate) {
          return;
        }

        const startedAt = Date.now();
        try {
          const draft = await new EvaluationRunner().evaluateCandidate(candidate.id);
          const elapsedMs = Date.now() - startedAt;
          const expected = expectedDecisionsFromCandidate(candidate);
          const actual = actualDecisionsFromDraftRaw(draft.evaluation.raw_model_output_json, draft.evaluation.decision_label);
          const comparison = recordLiveEvalComparison(summary, expected, actual);
          summary.completed += 1;
          const qualityStatus = comparison.qualityOk === null ? "SKIP" : comparison.qualityOk ? "PASS" : "MISS";
          const overallOk = comparison.targetOk && comparison.qualityOk !== false;
          console.log(
            `${index + 1}. ${overallOk ? "PASS" : "MISS"} target=${comparison.targetOk ? "PASS" : "MISS"} expected_target=${expected.targetUseDecision} actual_target=${actual.targetUseDecision} quality=${qualityStatus} expected_quality=${expected.qualityDecision || "n/a"} actual_quality=${actual.qualityDecision || "n/a"} score=${draft.evaluation.fit_score} elapsed_ms=${elapsedMs}`
          );
        } catch (error) {
          const elapsedMs = Date.now() - startedAt;
          summary.failures += 1;
          console.log(`${index + 1}. FAIL ${error instanceof Error ? error.message : "Evaluation failed."} elapsed_ms=${elapsedMs}`);
        }
      }
    })
  );
}

export function recordLiveEvalComparison(
  summary: LiveEvalSummary,
  expected: ExpectedLiveEvalDecisions,
  actual: ActualLiveEvalDecisions
): { targetOk: boolean; qualityOk: boolean | null } {
  const targetOk = actual.targetUseDecision === expected.targetUseDecision;
  summary.target_matches += targetOk ? 1 : 0;
  summary.target_misses += targetOk ? 0 : 1;

  if (!expected.qualityDecision) {
    return { targetOk, qualityOk: null };
  }

  const qualityOk = actual.qualityDecision === expected.qualityDecision;
  summary.quality_matches += qualityOk ? 1 : 0;
  summary.quality_misses += qualityOk ? 0 : 1;
  return { targetOk, qualityOk };
}

function expectedDecisionsFromCandidate(candidate: LiveEvalCandidate): ExpectedLiveEvalDecisions {
  const raw = parseRawObject(candidate.raw_model_output_json);
  return {
    targetUseDecision: decisionFromRaw(raw.expected_target_use_decision) || candidate.expected_decision,
    qualityDecision: decisionFromRaw(raw.expected_quality_decision)
  };
}

function actualDecisionsFromDraftRaw(rawJson: string | null, fallbackDecision: DecisionLabel): ActualLiveEvalDecisions {
  const raw = parseRawObject(rawJson);
  return {
    targetUseDecision: decisionFromRaw(raw.target_use_decision) || fallbackDecision,
    qualityDecision: decisionFromRaw(raw.asset_quality_decision)
  };
}

function parseRawObject(rawJson: string | null): Record<string, unknown> {
  if (!rawJson) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function decisionFromRaw(value: unknown): DecisionLabel | null {
  return value === "good" || value === "needs_edit" || value === "reject" ? value : null;
}

export function parseLiveEvalArgs(argv: string[], env: Record<string, string | undefined> = process.env): LiveEvalArgs {
  const providerIndex = argv.indexOf("--provider");
  const provider = providerIndex >= 0 ? argv[providerIndex + 1] : "gemini";
  if (provider !== "gemini" && provider !== "codex") {
    throw new Error(
      "Usage: npm run eval:live -- --provider gemini|codex [--dataset tests/evals/ai-character-chat] [--concurrency 5] [--timeout-ms 240000] [--keep-data]"
    );
  }

  const datasetIndex = argv.indexOf("--dataset");
  const datasetRoot = path.resolve(datasetIndex >= 0 ? argv[datasetIndex + 1] : "tests/evals/ai-character-chat");
  const concurrencyIndex = argv.indexOf("--concurrency");
  const rawConcurrency = concurrencyIndex >= 0 ? argv[concurrencyIndex + 1] : String(DEFAULT_LIVE_EVAL_CONCURRENCY);
  if (!rawConcurrency || !/^[1-9]\d*$/.test(rawConcurrency)) {
    throw new Error("Live eval concurrency must be a positive integer.");
  }
  const concurrencyValue = Number.parseInt(rawConcurrency, 10);
  const timeoutIndex = argv.indexOf("--timeout-ms");
  const rawTimeout =
    timeoutIndex >= 0 ? argv[timeoutIndex + 1] : env.EVALUATOR_TIMEOUT_MS || String(DEFAULT_LIVE_EVAL_TIMEOUT_MS);
  if (!rawTimeout || !/^[1-9]\d*$/.test(rawTimeout)) {
    throw new Error("Live eval timeout must be a positive integer.");
  }
  const timeoutMs = Number.parseInt(rawTimeout, 10);

  return {
    provider,
    datasetRoot,
    keepData: argv.includes("--keep-data"),
    concurrency: concurrencyValue,
    timeoutMs
  };
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Live eval failed.");
    process.exit(1);
  });
}
