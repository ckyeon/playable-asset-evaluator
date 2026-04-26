import { afterEach } from "vitest";
import { rmSync } from "node:fs";
import { closeDbForTests } from "@/lib/db/client";

afterEach(() => {
  closeDbForTests();
  const dataDir = process.env.ASSET_EVALUATOR_DATA_DIR;
  if (dataDir?.includes("asset-evaluator-test-")) {
    rmSync(dataDir, { recursive: true, force: true });
  }
  delete process.env.ASSET_EVALUATOR_DATA_DIR;
  delete process.env.EVALUATION_ADAPTER;
  delete process.env.EVALUATION_MODEL;
  delete process.env.EVALUATOR_MODEL_NAME;
  delete process.env.EVALUATOR_PROVIDER;
  delete process.env.EVALUATOR_TIMEOUT_MS;
});
