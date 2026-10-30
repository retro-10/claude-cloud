import { expect, test } from "@playwright/test";
import { ready, signIn } from "./helpers";

// ⌘K finds records, not only pages: a campaign by a misspelt name, then it shows under Recent next time; the
// actions list starts an expense request.
test.use({ contextOptions: { reducedMotion: "reduce" } });

test("command palette: records with a typo, recent destinations, and actions", async ({ page }) => {
  await signIn(page, "retro@orladent.local");
  await page.goto("/hq");
  await ready(page);
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Search records or commands" });
  await box.fill("mastrclass sep");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog.getByRole("group", { name: "Campaigns" }).getByRole("option", { name: /Masterclass Sep/ })).toBeVisible();
  await box.press("Enter");
  await page.waitForURL("**/growth/campaigns/*");

  await page.keyboard.press("Control+k");
  await expect(dialog.getByRole("group", { name: "Recent" }).getByRole("option", { name: /Masterclass Sep/ })).toBeVisible();
  await box.fill("new expense");
  await box.press("Enter");
  await page.waitForURL("**/approvals/new?type=expense");
  await expect(page.getByLabel("Amount (EGP)")).toBeVisible();
});
