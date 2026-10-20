import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ready, signIn } from "./helpers";

// HQ: spaces > lists > tasks with List / Board / Calendar / Table views, the task page, docs and the inbox,
// in a real browser against the built app. Every screen is scanned for WCAG 2.1 AA in both themes.
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function scan(page: Page, label: string) {
  for (const t of ["dark", "light"]) {
    await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")})`), `${label} (${t})`).toEqual([]);
  }
}

/** The page never scrolls sideways: wide content scrolls inside its own box, so the sidebar and top bar stay put. */
async function noSidewaysScroll(page: Page, label: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `${label} is wider than the window`).toBeLessThanOrEqual(r.cw);
}

test("HQ: set up spaces, plan work in every view, finish it from the board, write a doc, clear the inbox", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 860 });
  await signIn(page, "retro@orladent.local");

  // an empty HQ offers the starter layout
  await page.goto("/hq");
  await ready(page);
  await scan(page, "HQ home, empty");
  await page.getByRole("button", { name: "Create the five spaces" }).click();
  await expect(page.locator("[role=status]", { hasText: "HQ is set up" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  const views = page.getByRole("navigation", { name: "Views" });
  for (const s of ["Sales", "Academy", "Studio", "Marketing", "Operations"]) await expect(nav.getByRole("link", { name: s, exact: true })).toBeVisible();

  // List view: add tasks inline in two statuses
  await nav.getByRole("link", { name: "Academy", exact: true }).click();
  await page.waitForURL(/\/spaces\/\d+$/);
  await ready(page);
  const todo = page.locator("section[aria-label^='To do']");
  await todo.locator("input[name=title]").fill("Book the venue for the October batch");
  await todo.locator("input[name=title]").press("Enter");
  await expect(page.locator("[role=status]", { hasText: "Task added" })).toBeVisible();
  const doing = page.locator("section[aria-label^='In progress']");
  await doing.locator("input[name=title]").fill("Record the welcome video");
  await doing.locator("input[name=title]").press("Enter");
  await expect(page.locator("section[aria-label^='In progress'] a", { hasText: "Record the welcome video" })).toBeVisible();
  await scan(page, "space, list view");
  await noSidewaysScroll(page, "list view");

  // change a status from the row's picker
  await page.getByLabel("Status of Book the venue for the October batch").selectOption({ label: "Review" });
  await expect(page.locator("section[aria-label^='Review'] a", { hasText: "Book the venue" })).toBeVisible();

  // Board: drag a card into Done; it is finished, and leaves the open list. Each card's picker moves it without a mouse.
  await page.setViewportSize({ width: 1440, height: 860 });
  await views.getByRole("link", { name: "Board", exact: true }).click();
  await ready(page);
  await scan(page, "space, board view");
  await page.locator("li[draggable=true]", { hasText: "Record the welcome video" }).dragTo(page.locator("section[aria-label^='Done']"));
  await expect(page.locator("section[aria-label^='Done'] li", { hasText: "Record the welcome video" })).toBeVisible();
  await page.getByLabel("Move Book the venue for the October batch to").selectOption({ label: "In progress" });
  await expect(page.locator("section[aria-label^='In progress'] li", { hasText: "Book the venue" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // the save is in flight until the server answers
  await page.reload();
  await expect(page.locator("section[aria-label^='In progress'] li", { hasText: "Book the venue" })).toBeVisible();
  await expect(page.locator("section[aria-label^='Done'] li", { hasText: "Record the welcome video" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 860 });
  await views.getByRole("link", { name: "List", exact: true }).click();
  await ready(page);
  await expect(page.locator("main a", { hasText: "Record the welcome video" })).toHaveCount(0);

  // Table and Calendar
  await views.getByRole("link", { name: "Table", exact: true }).click();
  await ready(page);
  await expect(page.getByRole("region", { name: "Tasks table" })).toBeVisible();
  await page.getByLabel("Priority of Book the venue for the October batch").selectOption("urgent");
  await expect(page.getByLabel("Priority of Book the venue for the October batch")).toHaveValue("urgent");
  await scan(page, "space, table view");
  await noSidewaysScroll(page, "table view");
  await views.getByRole("link", { name: "Calendar", exact: true }).click();
  await ready(page);
  await expect(page.getByRole("region", { name: "Calendar" })).toBeVisible();
  await scan(page, "space, calendar view");

  // the task page: details, a subtask, the history
  await views.getByRole("link", { name: "List", exact: true }).click();
  await ready(page);
  await page.locator("main a", { hasText: "Book the venue for the October batch" }).click();
  await page.waitForURL(/\/tasks\/\d+$/);
  await ready(page);
  await page.fill("#sub-title", "Get three quotes");
  await page.press("#sub-title", "Enter");
  await expect(page.locator("main a", { hasText: "Get three quotes" })).toBeVisible();
  await page.getByLabel("Due").fill("2030-01-15");
  await page.getByLabel("Tags (comma separated)").fill("venue, ops");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.locator("[role=status]", { hasText: "Task saved" })).toBeVisible();
  await expect(page.locator("main")).toContainText("moved it");
  await scan(page, "task page");

  // home shows my work
  await page.goto("/hq");
  await ready(page);
  await expect(page.locator("main a", { hasText: "Book the venue for the October batch" })).toBeVisible();
  await scan(page, "HQ home");

  // docs: write a wiki page with a sub-page; Markdown renders
  await page.goto("/docs/new");
  await ready(page);
  await page.fill("#doc-title", "How we prepare a batch");
  await page.getByLabel("Space").selectOption({ label: "Academy" });
  await page.fill("textarea[name=body]", "# Two weeks before\n- [x] Venue booked\n- [ ] Kits ordered\n\n**Always** confirm the instructor.");
  await page.getByLabel("Wiki: the version to trust").check();
  await page.getByRole("button", { name: "Create doc" }).click();
  await page.waitForURL(/\/docs\/\d+\?notice=/);
  await expect(page.getByRole("heading", { name: "Two weeks before" })).toBeVisible();
  await expect(page.locator("main strong", { hasText: "Always" })).toBeVisible();
  await scan(page, "doc page");
  await page.getByRole("link", { name: "Sub-page" }).click();
  await page.fill("#doc-title", "Kit checklist");
  await page.getByRole("button", { name: "Create doc" }).click();
  await page.waitForURL(/\/docs\/\d+\?notice=/);
  await page.goto("/docs");
  await ready(page);
  await expect(page.locator("main a", { hasText: "Kit checklist" })).toBeVisible();
  await scan(page, "docs");

  // the inbox
  await page.goto("/inbox");
  await ready(page);
  await scan(page, "inbox");
  const clearAll = page.getByRole("button", { name: "Clear all" });
  if (await clearAll.count()) {
    await clearAll.click();
    await expect(page.locator("[role=status]", { hasText: "Inbox cleared" })).toBeVisible();
  }
  await expect(page.locator("main")).toContainText("Inbox zero");

  // space settings: rename a status; the board follows
  await page.goto("/hq");
  await page.locator("main a", { hasText: "Academy" }).first().click();
  await page.getByRole("link", { name: "Space settings" }).click();
  await ready(page);
  await scan(page, "space settings");
  await page.getByLabel("Status name").nth(2).fill("Waiting on supplier");
  await page.getByRole("button", { name: "Save space" }).click();
  await expect(page.locator("[role=status]", { hasText: "Space saved" })).toBeVisible();
  await page.goto(page.url().replace(/\/settings.*$/, "?view=board"));
  await expect(page.locator("section[aria-label^='Waiting on supplier']")).toBeVisible();
});

test("the shell never scrolls sideways at laptop widths", async ({ page }) => {
  await signIn(page, "retro@orladent.local");
  for (const width of [1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/leads", "/growth/campaigns", "/growth/content", "/settings/ai", "/finance/ledger", "/hq"]) {
      await page.goto(path);
      await ready(page);
      await noSidewaysScroll(page, `${path} at ${width}px`);
    }
  }
});
