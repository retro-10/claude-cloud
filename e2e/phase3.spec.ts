import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ready, signIn } from "./helpers";

// OrlaDent OS, Phase 3 (student success), in a real browser against the built app.
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function scan(page: Page, label: string) {
  for (const t of ["dark", "light"]) {
    await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")})`), `${label} (${t})`).toEqual([]);
  }
}

test("a term end to end: class and attendance, an assignment reviewed, graduation, the certificate checked, and the student's portal", async ({ page, browser }) => {
  await signIn(page, "retro@orladent.local");

  // a class for Demo Cohort A, and attendance for its first student
  await page.goto("/classes");
  await ready(page);
  const add = page.locator("form").filter({ has: page.locator("button", { hasText: "Add class" }) });
  await add.locator("select[name=cohortId]").selectOption({ label: "Demo Cohort A" });
  await add.locator("input[name=title]").fill("Crown design, part 1");
  await add.locator("input[name=startsAt]").fill("2026-09-20T18:00");
  await add.locator("button", { hasText: "Add class" }).click();
  await page.waitForURL("**/classes/*");
  await expect(page.locator("h1")).toHaveText("Crown design, part 1");
  await scan(page, "class page");
  const student = (await page.locator("main ul li a[href^='/leads/']").first().innerText()).trim();
  const studentHref = (await page.locator("main ul li a[href^='/leads/']").first().getAttribute("href"))!;
  await page.getByRole("group", { name: student }).getByLabel("Present").check();
  await page.click("button:has-text('Save attendance')");
  await expect(page.locator("[role=status]", { hasText: "Attendance saved" })).toBeVisible();

  // an assignment; their work recorded and reviewed
  await page.goto("/assignments");
  await ready(page);
  const asg = page.locator("form").filter({ has: page.locator("button", { hasText: "Add assignment" }) });
  await asg.locator("select[name=cohortId]").selectOption({ label: "Demo Cohort A" });
  await asg.locator("input[name=title]").fill("Case 1: posterior crown");
  await asg.locator("textarea[name=rubric]").fill("Fit | 60\nAnatomy | 40");
  await asg.locator("button", { hasText: "Add assignment" }).click();
  await page.waitForURL("**/assignments/*");
  const row = page.locator("main li").filter({ has: page.locator(`a[href='${studentHref}']`) });
  await row.locator("summary", { hasText: "Record a submission" }).click();
  await row.locator("input[name=link]").fill("https://drive.example/case1");
  await row.locator("button", { hasText: "Record" }).click();
  await expect(page.locator("[role=status]", { hasText: "Submission recorded" })).toBeVisible();
  await scan(page, "assignment page with a review form");
  await row.locator("input[name='score-0']").fill("54");
  await row.locator("input[name='score-1']").fill("34");
  await row.locator("textarea[name=feedback]").fill("Good margins; refine the cusp tips.");
  await row.locator("button", { hasText: "Save review" }).click();
  await expect(page.locator("[role=status]", { hasText: "Reviewed: 88%, passed" })).toBeVisible();

  // graduation and the certificate
  await page.goto("/cohorts");
  await page.locator("main a", { hasText: "Demo Cohort A" }).first().click();
  await page.locator("a", { hasText: "Graduation" }).click();
  await page.waitForURL("**/graduation");
  await scan(page, "graduation page");
  const grad = page.locator("main li").filter({ has: page.locator(`a[href='${studentHref}']`) });
  await grad.locator("button", { hasText: "Graduate and issue the certificate" }).click();
  await expect(page.locator("[role=status]", { hasText: "Certificate OC-" })).toBeVisible();
  const code = (await page.locator("[role=status]", { hasText: "Certificate OC-" }).innerText()).match(/OC-[A-Z2-9]{4}-[A-Z2-9]{4}/)![0];

  // anyone can check it
  const outside = await browser.newContext({ reducedMotion: "reduce" });
  const check = await outside.newPage();
  await check.goto(`/c/${code}`);
  await expect(check.locator("h1")).toHaveText("Valid certificate");
  await expect(check.locator("main")).toContainText(student);
  await outside.close();

  // portal access from the student's page, used in a fresh browser
  await page.goto(studentHref);
  await page.locator("section[aria-label='Student portal'] button", { hasText: "Give portal access" }).click();
  const link = (await page.locator("section[aria-label='Student portal'] code").innerText()).trim();
  expect(link).toMatch(/\/portal\/invite\/[A-Za-z0-9_-]{40,}$/);
  const portal = await browser.newContext({ reducedMotion: "reduce" });
  const me = await portal.newPage();
  await me.goto(link);
  await me.fill("input[name=password]", "my portal password");
  await me.fill("input[name=confirm]", "my portal password");
  await me.click("button[type=submit]");
  await me.waitForURL("**/portal");
  await expect(me.locator("main")).toContainText("Case 1: posterior crown");
  await expect(me.locator("main")).toContainText("Good margins; refine the cusp tips.");
  await expect(me.locator("main")).toContainText(code);
  await scan(me, "portal home");
  // the portal cookie opens nothing on the staff side
  await me.goto("/command");
  await me.waitForURL("**/login");
  await portal.close();
});
