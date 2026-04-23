import { test, expect } from "@playwright/test";

test("workspace renders the seeded style profile", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Asset Evaluator" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Korean card game casino remix/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reference assets" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Candidate image" })).toBeVisible();
});
