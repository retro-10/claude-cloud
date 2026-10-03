import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ready, signIn } from "./helpers";

// OrlaDent OS, Phase 2 (growth and content), in a real browser against the built app.
test.use({ contextOptions: { reducedMotion: "reduce" } });

test("a masterclass end to end: campaign, public form, a visitor signs up from a tracked link, attendance", async ({ page, browser }) => {
  await signIn(page, "retro@orladent.local");

  // the campaign
  await page.goto("/growth/campaigns");
  await ready(page);
  const create = page.locator("form").filter({ has: page.locator("button", { hasText: "Create campaign" }) });
  await create.locator("input[name=label]").fill("Masterclass: digital crowns");
  await create.locator("select[name=kind]").selectOption("masterclass");
  await create.locator("select[name=status]").selectOption("live");
  await create.locator("input[name=eventAt]").fill("2030-01-15T19:00");
  await create.locator("input[name=slug]").fill("mc-crowns");
  await create.locator("button", { hasText: "Create campaign" }).click();
  await page.waitForURL("**/growth/campaigns/*");
  await expect(page.locator("h1")).toHaveText("Masterclass: digital crowns");
  const campaignUrl = page.url().split("?")[0];

  // its sign-up form
  await page.goto("/growth/forms");
  await ready(page);
  const newForm = page.locator("form").filter({ has: page.locator("button", { hasText: "Create form" }) });
  await newForm.locator("input[name=title]").fill("Register for the free masterclass");
  await newForm.locator("input[name=slug]").fill("crowns");
  await newForm.locator("select[name=campaignId]").selectOption({ label: "Masterclass: digital crowns" });
  await newForm.locator("button", { hasText: "Create form" }).click();
  await expect(page.locator("[role=status]", { hasText: "Form created" })).toBeVisible();

  // a visitor (no session) opens the tracked link and signs up
  const visitor = await browser.newContext({ reducedMotion: "reduce" });
  const v = await visitor.newPage();
  await v.goto("/f/crowns?utm_source=instagram&utm_medium=story&utm_content=c1-teaser");
  await expect(v.locator("h1")).toHaveText("Register for the free masterclass");
  for (const t of ["dark", "light"]) {
    await v.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await v.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // let the new colours paint
    const { violations } = await new AxeBuilder({ page: v }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((x) => `${x.id}: ${x.help}`), `public form (${t})`).toEqual([]);
  }
  await v.fill("input[name=name]", "Mariam Adel");
  await v.fill("input[name=phone]", "0111 222 3344");
  await v.selectOption("select[name=segment]", "technician");
  await v.check("input[name=consent]");
  await v.waitForTimeout(2200); // a person takes more than 2 seconds; the stamp refuses faster posts
  await v.click("button[type=submit]");
  await expect(v.locator("[role=status]")).toContainText("Thank you");
  await visitor.close();

  // the lead arrived under the campaign, with where it came from
  await page.goto(campaignUrl);
  await expect(page.locator("main")).toContainText("Mariam Adel");
  await page.locator("main a", { hasText: "Mariam Adel" }).click();
  await expect(page.locator("main")).toContainText("instagram · story · c1-teaser");

  // the masterclass page: registered, then marked as came
  await page.goto("/growth/events");
  await ready(page);
  await page.locator("main a", { hasText: "Masterclass: digital crowns" }).click();
  await page.waitForURL("**/growth/events/*");
  await expect(page.locator("main")).toContainText("Mariam Adel");
  await page.getByLabel("Did Mariam Adel come?").selectOption("yes");
  await page.click("button:has-text('Save attendance')");
  await expect(page.locator("[role=status]", { hasText: "Attendance saved" })).toBeVisible();
  await expect(page.getByLabel("Did Mariam Adel come?")).toHaveValue("yes");
});

test("content: plan a piece, move it on the board; a referral link on a lead", async ({ page }) => {
  await signIn(page, "retro@orladent.local");
  await page.goto("/growth/content");
  await ready(page);
  const plan = page.locator("form").filter({ has: page.locator("button", { hasText: "Add to the calendar" }) });
  await plan.locator("input[name=title]").fill("Crown design in 60 seconds");
  await plan.locator("select[name=format]").selectOption("reel");
  await plan.locator("button", { hasText: "Add to the calendar" }).click();
  await page.waitForURL("**/growth/content/*");
  await expect(page.locator("h1")).toHaveText("Crown design in 60 seconds");
  await page.goto("/growth/content?view=board");
  await page.locator("button[aria-label='Move Crown design in 60 seconds to Scripting']").click();
  await expect(page.locator("section[aria-label='Scripting']")).toContainText("Crown design in 60 seconds");

  await page.goto("/leads");
  await ready(page);
  await page.locator("tbody a[href^='/leads/']").first().click();
  await page.locator("section[aria-label='Referrals'] button", { hasText: "Make referral link" }).click();
  await expect(page.locator("[role=status]", { hasText: "Referral link ready" })).toBeVisible();
  await expect(page.locator("section[aria-label='Referrals']")).toContainText("Their referral link");
});
