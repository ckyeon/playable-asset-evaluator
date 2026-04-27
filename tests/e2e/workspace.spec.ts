import { test, expect } from "@playwright/test";
import path from "node:path";

test("workspace renders the seeded style profile", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Asset Evaluator" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Korean card game casino remix/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Generation contexts" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Matgo -> Slot playable/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Matgo -> Slot playable/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prompt revisions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Candidate stage" })).toBeVisible();
  await expect(page.getByText("Secondary memory")).toBeVisible();
});

test("workspace shows a recoverable evaluation error", async ({ page }) => {
  const candidateAsset = path.join(
    process.cwd(),
    "tests/evals/ai-character-chat/assets/candidates/cand-01-nervous-clasped-hands.png"
  );

  await page.route("**/api/candidates/*/evaluate", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Evaluation CLI failed." })
    });
  });

  await page.goto("/workspace");
  await page.getByRole("button", { name: /Korean card game casino remix/ }).click();
  await page.getByRole("button", { name: /Matgo -> Slot playable/ }).click();
  await page.getByLabel("Candidate prompt").fill("Nervous emotion pose, same character.");
  const candidateUploadResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/generation-contexts/") &&
      response.url().includes("/candidates") &&
      response.request().method() === "POST"
  );
  await page.getByTestId("candidate-file-input").setInputFiles(candidateAsset);
  await candidateUploadResponse;
  await expect(page.getByText("Candidate image saved.")).toBeVisible();
  await page.getByRole("button", { name: "Evaluate candidate" }).click();
  await expect(page.getByText("Evaluation CLI failed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Evaluate candidate" })).toBeEnabled();
});

test("workspace creates a context, uploads sources and candidate, evaluates, saves, and groups history", async ({ page }) => {
  test.setTimeout(60_000);
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

  await page.getByText("New context").click();
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
  await expect(page.getByText("Uploaded for this context")).toBeVisible();

  await page.getByLabel("Candidate prompt").fill("Nervous emotion pose, same character, transparent-friendly composition.");
  await page.getByTestId("candidate-file-input").setInputFiles(candidateAsset);
  await expect(page.getByText("Candidate image saved.")).toBeVisible();
  await expect(page.getByAltText("Current candidate")).toBeVisible();
  const revisionRow = page.getByRole("option", {
    name: /Base.*1 candidate.*Nervous emotion pose, same character, transparent-friendly composition/i
  });
  await expect(revisionRow).toBeVisible();
  await expect(revisionRow).toHaveAttribute("aria-current", "true");
  await revisionRow.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByAltText("Current candidate")).toBeVisible();

  await page.getByRole("button", { name: "Evaluate candidate" }).click();
  await expect(page.getByText("Draft evaluation saved.")).toBeVisible();
  await expect(page.getByText("profile_fit · 78")).toBeVisible();
  await expect(page.getByText("source_asset_match · 72")).toBeVisible();
  await page.getByRole("button", { name: "Follow-up" }).click();
  await page.getByText("Revision metadata").click();
  await expect(page.getByLabel("Source guidance").locator("option")).toHaveCount(1);

  await page.getByLabel("Human reason").fill("Good character continuity, but the pose needs cleaner production edges.");
  await expect(page.getByLabel("Next prompt guidance")).toHaveValue(/separate the body from the background/);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText("Judgment saved to creative memory.")).toBeVisible();
  await page.getByText("Secondary memory").click();
  await expect(page.getByText("1 saved judgments")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`${contextName}.*needs_edit`, "i") })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create next revision" })).toBeVisible();
  await page.getByRole("button", { name: "Create next revision" }).click();
  await expect(page.getByText("Next prompt revision created.")).toBeVisible();
  await expect(
    page.getByRole("option", {
      name: /next revision.*Unknown.*0 candidates.*Guidance.*Keep the same character.*Keep the same character/i
    })
  ).toBeVisible();
  await expect(page.getByLabel("Candidate prompt")).toHaveValue(/separate the body from the background/);

  await revisionRow.click();
  await page.getByRole("button", { name: "Follow-up" }).click();
  await expect(page.getByLabel("Parent revision")).toBeVisible();
  if (!(await page.getByLabel("Source guidance").isVisible())) {
    await page.getByText("Revision metadata").click();
  }
  await expect(page.getByLabel("Source guidance").locator("option")).toHaveCount(2);
  await page.getByLabel("Source guidance").selectOption({ index: 1 });

  await page.getByLabel("Candidate prompt").fill("Nervous pose child revision with cleaner silhouette.");
  await page.getByLabel("Revision label").fill("child e2e");
  const childUploadResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/generation-contexts/") &&
      response.url().includes("/candidates") &&
      response.request().method() === "POST"
  );
  await page.getByTestId("candidate-file-input").setInputFiles(candidateAsset);
  await childUploadResponse;
  const childRevisionRow = page.getByRole("option", {
    name: /child e2e.*Unknown.*1 candidate.*Guidance.*Keep the same character.*Nervous pose child revision with cleaner silhouette/i
  });
  await expect(childRevisionRow).toBeVisible();

  await childRevisionRow.click();
  await page.getByRole("button", { name: "Attach existing" }).click();
  await expect(page.getByLabel("Candidate prompt")).toHaveValue(/cleaner silhouette/);
  const rowCountBeforeAttach = await page.getByTestId("prompt-revision-row").count();
  const attachUploadResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/generation-contexts/") &&
      response.url().includes("/candidates") &&
      response.request().method() === "POST"
  );
  await page.getByTestId("candidate-file-input").setInputFiles(candidateAsset);
  await attachUploadResponse;
  await expect(
    page.getByRole("option", {
      name: /child e2e.*Unknown.*2 candidates.*Nervous pose child revision with cleaner silhouette/i
    })
  ).toBeVisible();
  await expect(page.getByTestId("prompt-revision-row")).toHaveCount(rowCountBeforeAttach);

  const promptRevisionSummary = page.locator(".prompt-revision-strip .panel-header .microcopy");
  await expect(promptRevisionSummary).toHaveText(new RegExp(`3 revisions in ${contextName}`));
  const revisionSummaryBeforeMissing = await promptRevisionSummary.innerText();
  await page.getByLabel("Prompt missing").check();
  await page.getByLabel("Recovery note").fill("Prompt was lost after export.");
  const missingUploadResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/generation-contexts/") &&
      response.url().includes("/candidates") &&
      response.request().method() === "POST"
  );
  await page.getByTestId("candidate-file-input").setInputFiles(candidateAsset);
  await missingUploadResponse;
  await expect(promptRevisionSummary).toHaveText(revisionSummaryBeforeMissing);
  await expect(page.locator('[role="option"][aria-current="true"]')).toHaveCount(0);

  await page.getByLabel("Prompt missing").uncheck();
  await expect(page.getByRole("button", { name: "New base" })).toBeEnabled();
  await page.getByRole("button", { name: "New base" }).click();
  await page.getByLabel("Candidate prompt").fill("Invalid parameters prompt.");
  if (!(await page.getByLabel("Parameters JSON").isVisible())) {
    await page.getByText("Revision metadata").click();
  }
  const parametersJsonInput = page.getByLabel("Parameters JSON");
  await parametersJsonInput.fill("[]");
  await expect(parametersJsonInput).toHaveValue("[]");
  const rowCountBeforeInvalidParameters = await page.getByTestId("prompt-revision-row").count();
  await page.getByTestId("candidate-file-input").setInputFiles(candidateAsset);
  await expect(page.getByText("Parameters JSON must be a valid JSON object.")).toBeVisible();
  await expect(page.getByTestId("prompt-revision-row")).toHaveCount(rowCountBeforeInvalidParameters);

  await page.getByRole("button", { name: new RegExp(`${contextName}.*needs_edit`, "i") }).click();
  await expect(page.getByLabel("Next prompt guidance")).toHaveValue(/separate the body from the background/);
  await page.getByLabel("Next prompt guidance").fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Judgment saved to creative memory.")).toBeVisible();
  await page.getByRole("button", { name: "Follow-up" }).click();
  if (!(await page.getByLabel("Source guidance").isVisible())) {
    await page.getByText("Revision metadata").click();
  }
  await expect(page.getByLabel("Source guidance").locator("option")).toHaveCount(1);
});
