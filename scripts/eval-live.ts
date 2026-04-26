import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDbForTests, getDb } from "@/lib/db/client";
import { EvalManifestImporter } from "@/lib/evals/import-manifest";
import { EvaluationRunner } from "@/lib/services/evaluation-runner";

type Provider = "gemini" | "codex";

interface Args {
  provider: Provider;
  datasetRoot: string;
  keepData: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = mkdtempSync(path.join(tmpdir(), `asset-evaluator-live-${args.provider}-`));
  process.env.ASSET_EVALUATOR_DATA_DIR = dataDir;
  process.env.EVALUATION_ADAPTER = "local-cli";
  process.env.EVALUATOR_PROVIDER = args.provider;

  try {
    await new EvalManifestImporter().importDataset(args.datasetRoot);
    const db = getDb();
    const candidates = db
      .prepare(
        `SELECT c.id, c.prompt_text, e.decision_label AS expected_decision
         FROM candidate_images c
         JOIN evaluations e ON e.candidate_image_id = c.id AND e.evaluation_state = 'saved'
         ORDER BY c.created_at ASC`
      )
      .all() as Array<{ id: string; prompt_text: string | null; expected_decision: string }>;

    let matches = 0;
    let failures = 0;
    console.log(`Live evaluator: ${args.provider}`);
    console.log(`Dataset: ${args.datasetRoot}`);
    console.log(`Candidates: ${candidates.length}`);

    for (const [index, candidate] of candidates.entries()) {
      try {
        const draft = await new EvaluationRunner().evaluateCandidate(candidate.id);
        const actual = draft.evaluation.decision_label;
        const ok = actual === candidate.expected_decision;
        matches += ok ? 1 : 0;
        console.log(
          `${index + 1}. ${ok ? "PASS" : "MISS"} expected=${candidate.expected_decision} actual=${actual} score=${draft.evaluation.fit_score}`
        );
      } catch (error) {
        failures += 1;
        console.log(`${index + 1}. FAIL ${error instanceof Error ? error.message : "Evaluation failed."}`);
      }
    }

    console.log(`Summary: ${matches}/${candidates.length} label matches, ${failures} failures.`);
    if (matches !== candidates.length || failures > 0) {
      process.exitCode = 1;
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

function parseArgs(argv: string[]): Args {
  const providerIndex = argv.indexOf("--provider");
  const provider = providerIndex >= 0 ? argv[providerIndex + 1] : "gemini";
  if (provider !== "gemini" && provider !== "codex") {
    throw new Error("Usage: npm run eval:live -- --provider gemini|codex [--dataset tests/evals/ai-character-chat] [--keep-data]");
  }

  const datasetIndex = argv.indexOf("--dataset");
  const datasetRoot = path.resolve(datasetIndex >= 0 ? argv[datasetIndex + 1] : "tests/evals/ai-character-chat");
  return {
    provider,
    datasetRoot,
    keepData: argv.includes("--keep-data")
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live eval failed.");
  process.exit(1);
});
