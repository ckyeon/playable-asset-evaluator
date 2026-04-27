import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  expect: {
    timeout: 15000
  },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry"
  },
  webServer: {
    command:
      "rm -rf tmp/e2e-data && mkdir -p tmp/e2e-data && ASSET_EVALUATOR_DATA_DIR=tmp/e2e-data npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/workspace",
    reuseExistingServer: false,
    timeout: 120000
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 }
      }
    }
  ]
});
