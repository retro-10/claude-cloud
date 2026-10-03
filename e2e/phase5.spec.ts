import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ready, signIn } from "./helpers";

// OrlaDent OS, Phase 5 (the AI assistant), in a real browser against the built app. Claude is replaced by a
// deterministic fake (AI_FAKE=e2e, only honoured on a crm_e2e* database), so no API key is needed.
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function scan(page: Page, label: string) {
  for (const t of ["dark", "light"]) {
    await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")})`), `${label} (${t})`).toEqual([]);
  }
}

test("the assistant: off until an owner switches it on, then Ask OrlaDent answers with links and drafts a WhatsApp reply", async ({ page }) => {
  await signIn(page, "sayed@orladent.local");

  // off by default: the page says why and offers the settings
  await page.goto("/ask");
  await ready(page);
  await expect(page.locator("[role=note]")).toContainText("switched off");
  await expect(page.locator("textarea[name=question]")).toBeDisabled();

  // an owner switches it on
  await page.goto("/settings/ai");
  await ready(page);
  await scan(page, "AI settings");
  await page.getByLabel("Switch the AI assistant on").check();
  await page.click("button:has-text('Save')");
  await expect(page.locator("[role=status]", { hasText: "Saved" })).toBeVisible();

  // ask a question: the fake looks up the batches and answers with a link to one
  await page.goto("/ask");
  await ready(page);
  await page.fill("textarea[name=question]", "How full are the batches?");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/ask\?t=\d+/);
  const answer = page.locator("ol li").last();
  await expect(answer).toContainText(/There are \d+ batches/);
  await expect(answer).toContainText("Looked at:");
  await expect(answer).toContainText("Batches and seats");
  await expect(page.locator("nav[aria-label] a, a").filter({ hasText: "How full are the batches?" }).first()).toBeVisible();
  await scan(page, "Ask OrlaDent conversation");
  const link = answer.locator("a[href^='/cohorts/']");
  await link.click();
  await page.waitForURL(/\/cohorts\/\d+/);
  await expect(page.locator("main")).toContainText("Early warning");

  // a WhatsApp draft from the composer: written, editable, never sent by the app
  await page.goto("/pipeline");
  await ready(page);
  await page.locator("main a", { hasText: "Demo Lead 03" }).first().click();
  await page.waitForURL(/\/leads\/\d+/);
  await ready(page);
  await page.locator("main button[title='Write a WhatsApp message from a template']").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("button", { hasText: "AI draft" }).click();
  await dialog.locator("button", { hasText: "Draft a reply" }).click();
  await expect(dialog.locator("textarea")).toHaveValue(/test draft/);
  await expect(dialog).toContainText("Nothing is sent from the CRM");
});

test("people without the assistant don't see it; the new screens pass accessibility checks", async ({ page, browser }) => {
  await signIn(page, "sayed@orladent.local");
  await expect(page.locator("nav[aria-label=Main]")).toContainText("Ask OrlaDent");
  for (const path of ["/ask", "/command", "/cohorts"]) {
    await page.goto(path);
    await ready(page);
    await expect(page.locator("h1").first()).toBeVisible();
    await scan(page, path);
  }
  // a batch page with its early warning card
  await page.goto("/cohorts");
  await page.locator("main a[href^='/cohorts/']").first().click();
  await page.waitForURL(/\/cohorts\/\d+$/);
  await ready(page);
  await scan(page, "batch page");

  // a designer has no Ask OrlaDent
  await page.goto("/settings/users");
  const newUser = page.locator("form").filter({ has: page.locator("button", { hasText: "Create user" }) });
  await newUser.locator("input[name=name]").fill("Dalia Designer");
  await newUser.locator("input[name=email]").fill("dalia@orladent.local");
  await newUser.locator("select[name=role]").selectOption("designer");
  await newUser.locator("input[name=password]").fill("e2e-password-1");
  await newUser.locator("button").click();
  await expect(page.locator("main")).toContainText("dalia@orladent.local");
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const d = await ctx.newPage();
  await signIn(d, "dalia@orladent.local");
  await expect(d.locator("nav[aria-label=Main]")).not.toContainText("Ask OrlaDent");
  expect((await d.goto("/ask"))?.status()).toBe(404);
  await ctx.close();
});
