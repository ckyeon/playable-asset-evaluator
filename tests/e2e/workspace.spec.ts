import { test, expect } from "@playwright/test";
import path from "node:path";

test("workspace renders the seeded style profile", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Asset Evaluator" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Korean card game casino remix/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Generation contexts" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Matgo -> Slot playable/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Matgo -> Slot playable/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reference assets" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Candidate image" })).toBeVisible();
});

test("workspace creates a context, uploads sources and candidate, evaluates, saves, and groups history", async ({ page }) => {
  const sourceAsset = path.join(
    process.cwd(),
    "tests/evals/ai-character-chat/assets/references/ref-01-couch-hand-cover.png"
  );
  const candidateAsset = path.join(
    process.cwd(),
    "tests/evals/ai-character-chat/assets/candidates/cand-01-nervous-clasped-hands.png"
  );
  const contextName = `E2E emotion batch ${Date.now()}`;

  await page.route("**/api/candidates/*/evaluate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        draft: {
          evaluation: {
            id: "draft-eval-e2e",
            fit_score: 74,
            decision_label: "needs_edit",
            human_reason: null,
            ai_summary: "Character identity mostly matches, but the pose needs cleaner reusable edges.",
            confidence_state: "normal",
            evaluation_state: "draft"
          },
          criteria: [
            { criterion: "profile_fit", score: 78, reason: "Face and outfit stay close to the profile." },
            { criterion: "source_asset_match", score: 72, reason: "Uses the same character source but changes the crop." },
            { criterion: "prompt_intent_match", score: 74, reason: "Nervous emotion is readable." },
            { criterion: "production_usability", score: 68, reason: "Reusable, but the pose still needs cleanup." }
          ],
          next_prompt_guidance: "Keep the same character, separate the body from the background, and simplify the pose silhouette.",
          weak_reference_set: false
        }
      })
    });
  });

  await page.goto("/workspace");
  await page.getByRole("button", { name: /Korean card game casino remix/ }).click();

  await page.getByLabel("Context name").fill(contextName);
  await page.getByLabel("Generation goal").fill("Generate reusable emotion poses for the same character.");
  await page.getByLabel("Source prompt").fill("캐릭터 이미지를 각 감정별로 생성해줘.");
  await page.getByRole("button", { name: "Create context" }).click();

  await expect(page.getByText("Generation context created.")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(contextName) })).toBeVisible();
  await expect(page.getByRole("heading", { name: contextName })).toBeVisible();

  await page.getByLabel("Context source note").fill("Reference used for this emotion generation batch.");
  await page.getByTestId("context-source-file-input").setInputFiles(sourceAsset);
  await expect(page.getByText("Context source asset saved.")).toBeVisible();
  await expect(page.getByText("context_upload")).toBeVisible();

  await page.getByLabel("Candidate prompt").fill("Nervous emotion pose, same character, transparent-friendly composition.");
  await page.getByTestId("candidate-file-input").setInputFiles(candidateAsset);
  await expect(page.getByText("Candidate image saved.")).toBeVisible();
  await expect(page.getByAltText("Current candidate")).toBeVisible();

  await page.getByRole("button", { name: "Evaluate candidate" }).click();
  await expect(page.getByText("Draft evaluation saved.")).toBeVisible();
  await expect(page.getByText("profile_fit · 78")).toBeVisible();
  await expect(page.getByText("source_asset_match · 72")).toBeVisible();

  await page.getByLabel("Human reason").fill("Good character continuity, but the pose needs cleaner production edges.");
  await expect(page.getByLabel("Next prompt guidance")).toHaveValue(/separate the body from the background/);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Judgment saved to creative memory.")).toBeVisible();
  await expect(page.getByText("1 saved judgments")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`${contextName}.*needs_edit`, "i") })).toBeVisible();
});
