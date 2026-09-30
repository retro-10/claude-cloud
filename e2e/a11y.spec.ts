import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ready, signIn } from "./helpers";

// Automated WCAG 2.1 A/AA checks (axe-core) on every screen, in both themes, as an owner so that
// every screen is reachable. Automated checks catch roughly a third of accessibility problems:
// the keyboard and screen-reader notes in USER_GUIDE.md / DECISIONS.md cover the rest.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// Cards and dialogs fade in; scanned mid-fade their text is partly transparent and fails contrast.
// Check the settled state: with reduced motion the app's CSS turns the animations off.
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function scan(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n   ")}`);
  expect(summary, `${label}\n${summary.join("\n")}`).toEqual([]);
}

async function theme(page: Page, t: "dark" | "light") {
  await page.evaluate((v) => {
    document.documentElement.dataset.theme = v;
    try {
      localStorage.setItem("theme", v);
    } catch {}
  }, t);
}

for (const t of ["dark", "light"] as const) {
  test(`login page has no accessibility violations (${t})`, async ({ page }) => {
    await page.goto("/login");
    await theme(page, t);
    await scan(page, `login ${t}`);
  });

  test(`every signed-in screen has no accessibility violations (${t})`, async ({ page }) => {
    await signIn(page, "retro@orladent.local");
    await page.goto("/leads");
    await ready(page);
    const firstLead = await page.locator("tbody a[href^='/leads/']").first().getAttribute("href");
    const firstCohort = "/cohorts";
    const screens = [
      "/", "/?mine=1", "/leads", "/leads?stage=contacted&q=demo", "/leads/import", firstLead!, "/pipeline", firstCohort, "/dashboard",
      "/dashboard?all=1", "/account", "/settings/users", "/settings/pipeline", "/settings/lists", "/settings/cadences", "/settings/audit",
      "/settings/rules", "/settings/workflows", "/settings/templates", "/leads?view=no_next_step", "/leads?view=no_decision_review",
      `/leads/merge?a=${firstLead!.split("/").pop()}`, "/finance", "/finance/ledger", "/finance/candidates", "/settings/finance",
      "/settings/integrations", "/settings/team", "/proof", "/tasks", "/tasks?who=done", "/settings/targets", "/command",
    ];
    for (const path of screens) {
      await page.goto(path);
      await ready(page);
      await theme(page, t);
      await expect(page.locator("h1").first()).toBeVisible();
      await scan(page, `${path} (${t})`);
    }
    // the cohort detail page too
    await page.goto("/cohorts");
    await ready(page);
    await page.locator("main a[href^='/cohorts/']").first().click();
    await theme(page, t);
    await scan(page, `cohort detail (${t})`);
    // an enrolled student's page: payments and the programme card (sessions, proof), with its forms open
    await page.locator("main tbody a[href^='/leads/']").first().click();
    await ready(page);
    await theme(page, t);
    await page.evaluate(() => document.querySelectorAll("section[aria-label='Programme'] details, section[aria-label='Tasks'] details").forEach((d) => d.setAttribute("open", "")));
    await scan(page, `student with programme (${t})`);
  });

  test(`open dialogs have no accessibility violations (${t})`, async ({ page }) => {
    await signIn(page, "retro@orladent.local");
    await page.goto("/leads");
    await ready(page);
    await theme(page, t);
    await ready(page);
    await page.keyboard.press("n");
    await expect(page.locator("[role=dialog]")).toBeVisible();
    await scan(page, `quick add (${t})`);
    await page.keyboard.press("Escape");

    await page.goto("/pipeline");

    await ready(page);
    await theme(page, t);
    await page.locator("li", { hasText: "Demo Lead 14" }).locator("select").selectOption({ label: "Lost" });
    await expect(page.locator("[role=dialog]")).toBeVisible();
    await scan(page, `lost dialog (${t})`);
    await page.keyboard.press("Escape");

    await page.goto("/");

    await ready(page);
    await theme(page, t);
    await ready(page);
    // the shortcut only works once the page's scripts have loaded: retry until the palette opens
    await expect(async () => {
      if (!(await page.locator("[role=dialog][aria-label='Command palette']").isVisible())) await page.keyboard.press("Control+k");
      await expect(page.locator("[role=dialog][aria-label='Command palette']")).toBeVisible({ timeout: 1000 });
    }).toPass();
    await page.keyboard.type("demo");
    await expect(page.locator("[role=option]").first()).toBeVisible();
    await scan(page, `command palette (${t})`);
    await page.keyboard.press("Escape");

    await page.goto("/finance");
    await ready(page);
    await theme(page, t);
    await page.locator("main button:has-text('Withdrawal')").click();
    await expect(page.locator("[role=dialog]")).toBeVisible();
    await scan(page, `ledger entry dialog (${t})`);
    await page.keyboard.press("Escape");

    await page.goto("/");
    await ready(page);
    await theme(page, t);
    await page.locator("#queue button:has-text('Reply')").first().click();
    await expect(page.locator("[aria-labelledby=composer-title] button:has-text('First reply')").first()).toBeVisible();
    await scan(page, `message composer (${t})`);
  });
}

test("the whole app can be used from the keyboard: skip link, shortcuts, focus indicator", async ({ page }) => {
  await signIn(page, "retro@orladent.local");
  await page.goto("/leads");
  await ready(page);
  // first Tab stop is the skip link and it works
  await page.keyboard.press("Tab");
  await expect(page.locator("a:has-text('Skip to content')")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  // "/" focuses the search box, "n" opens quick add, Escape closes it
  await ready(page);
  await page.keyboard.press("/");
  await expect(page.locator("#search")).toBeFocused();
  await page.locator("#search").blur();
  await ready(page);
  await page.keyboard.press("n");
  await expect(page.locator("[role=dialog]")).toBeVisible();
  await expect(page.locator("[role=dialog] input[name=fullName]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("[role=dialog]")).toHaveCount(0);
  // a focused control shows the gold outline
  await page.locator("a:has-text('Leads')").first().focus();
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");
});
