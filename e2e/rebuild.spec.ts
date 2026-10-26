import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ready, signIn } from "./helpers";

// The rebuild (runs after the other journeys: it replaces the old cycle's ledger). An owner imports a synthetic
// Cycle Close workbook, checks it against the workbook's own cash, sees the settlement, edits a rule, and walks the
// monthly partner review. Every screen is scanned for WCAG 2.1 AA in both themes.
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function scan(page: Page, label: string) {
  // after a client-side navigation the page title is set a moment after the URL changes: scan the settled page
  await page.waitForFunction(() => document.title.trim().length > 0);
  for (const t of ["dark", "light"]) {
    await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")})`), `${label} (${t})`).toEqual([]);
  }
}

test("rebuild: import the workbook, settle the old cycle, edit the rules, run the partner review", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, "sayed@orladent.local");

  // import: preview first, then import
  await page.goto("/finance/import");
  await ready(page);
  await page.setInputFiles("input[type=file]", join(process.cwd(), "tests", "fixtures", "cycle-close.xlsx"));
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("Matches the workbook's Cycle Position")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Rows to import" }).locator("tbody tr")).toHaveCount(52);
  await scan(page, "workbook preview");
  await page.getByLabel("Cycle close date").fill("2026-10-30");
  await page.getByLabel("Date for the imported rows").fill("2026-10-25");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Imported 52 rows/ })).toBeVisible({ timeout: 20_000 });

  // the settlement at the close, to the pound
  await page.goto("/finance/cycle");
  await ready(page);
  const table = page.getByRole("region", { name: /Settlement/ }).or(page.locator("main table").first());
  for (const [who, amount] of [["Badr", "+38,988 EGP"], ["Sayyed", "+28,325 EGP"], ["Retro", "-27,206 EGP"], ["Mo", "+25,294 EGP"]])
    await expect(table.first().locator("tr", { has: page.locator("th", { hasText: new RegExp(`^${who}$`) }) })).toContainText(amount);
  await expect(page.getByText("Balances add up to the cash.")).toBeVisible();
  await scan(page, "cycle close");

  // a rule changed in Settings flows into the pages
  await page.goto("/settings/finance");
  await ready(page);
  await scan(page, "finance settings");
  await page.getByLabel("Kept in the company (% of profit)").fill("25");
  await page.getByRole("button", { name: "Save the rules" }).click();
  await expect(page.locator("[role=status]", { hasText: "Finance model saved" })).toBeVisible();
  await expect(page.getByLabel("Kept in the company (% of profit)")).toHaveValue("25");

  // the functions and owners drive the salary split
  await page.goto("/team/functions");
  await ready(page);
  await expect(page.locator("main")).toContainText("Every line has one accountable partner");
  await scan(page, "functions");

  // the monthly partner review: scores saved, the waterfall shown
  await page.goto("/finance/pay?month=2026-11");
  await ready(page);
  await expect(page.getByRole("heading", { name: /Partner review/ })).toBeVisible();
  for (const input of await page.getByLabel("Score %").all()) await input.fill("70");
  await page.getByRole("button", { name: "Save scores" }).click();
  await expect(page.locator("[role=status]", { hasText: "Scores saved" })).toBeVisible();
  await expect(page.getByLabel("Score %").first()).toHaveValue("70");
  await expect(page.getByRole("region", { name: /Salaries/ }).first()).toContainText("3,500"); // the synthetic workbook: Retro's Tier 1 X
  await scan(page, "partner pay");
});
