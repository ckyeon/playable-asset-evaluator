#!/usr/bin/env node

import path from "node:path";
import { EvalManifestImportError, EvalManifestImporter } from "../lib/evals/import-manifest";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const datasetArg = args.find((arg) => !arg.startsWith("--"));

  if (!datasetArg) {
    console.error("Usage: npm run eval:import -- <dataset-dir> [--dry-run]");
    process.exit(1);
  }

  const datasetRoot = path.resolve(process.cwd(), datasetArg);

  try {
    const result = await new EvalManifestImporter().importDataset(datasetRoot, { dryRun });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof EvalManifestImportError) {
      console.error(JSON.stringify(error.result, null, 2));
      process.exit(1);
    }

    console.error(error instanceof Error ? error.message : "Eval manifest import failed.");
    process.exit(1);
  }
}

void main();
