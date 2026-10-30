import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Approvals and the Marketing role. An owner adds a marketer, who works in HQ and Growth without seeing lead
// records, asks for an expense; Mo (finance) approves it from the inbox in one click; the marketer sees the answer.
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function scan(page: Page, label: string) {
  await page.waitForFunction(() => document.title.trim().length > 0);
  for (const t of ["dark", "light"]) {
    await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")})`), `${label} (${t})`).toEqual([]);
  }
}

test("a marketer works without lead records; an expense is asked, routed, approved from the inbox and recorded", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, "retro@orladent.local");
  await owner.goto("/settings/approvals");
  await scan(owner, "approval routing settings");
  await owner.goto("/settings/users");
  await owner.locator("form", { hasText: "Add a user" }).getByLabel("Name").fill("Nour");
  await owner.locator("form", { hasText: "Add a user" }).getByLabel("Email").fill("nour@orladent.local");
  await owner.locator("form", { hasText: "Add a user" }).getByLabel("Role").selectOption("marketing");
  await owner.locator("form", { hasText: "Add a user" }).getByLabel(/Initial password/).fill("marketing-pass-1");
  await owner.getByRole("button", { name: "Create user" }).click();
  await expect(owner.locator("main")).toContainText("nour@orladent.local");

  // Nour: HQ and Growth in the sidebar, no lead list; lead pages are not found; campaign pages show counts, not names
  const nour = await (await browser.newContext()).newPage();
  await signIn(nour, "nour@orladent.local", "marketing-pass-1");
  await expect(nour).toHaveURL(/\/hq$/);
  const side = nour.getByRole("navigation").first();
  await expect(side.getByRole("link", { name: "Campaigns" })).toBeVisible();
  await expect(side.getByRole("link", { name: /^Approvals/ })).toBeVisible();
  await expect(side.getByRole("link", { name: "Leads", exact: true })).toHaveCount(0);
  const res = await nour.goto("/leads");
  expect(res?.status()).toBe(404);
  await nour.goto("/growth/campaigns");
  await nour.locator("main tbody a[href^='/growth/campaigns/']").first().click();
  await nour.waitForURL("**/growth/campaigns/*");
  await expect(nour.locator("main")).toContainText("names and stages are visible to sales and owners");
  await expect(nour.locator("main a[href^='/leads/']")).toHaveCount(0);

  // Nour asks for an expense; the form says who will approve
  await nour.goto("/approvals/new?type=expense");
  await scan(nour, "new request");
  await expect(nour.locator("main")).toContainText(/Goes to: .*Mo/);
  await nour.getByLabel("What is it?").fill("Boost the masterclass reel");
  await nour.getByLabel("Amount (EGP)").fill("1500");
  await nour.getByLabel("Category (optional)").fill("Ads");
  await nour.getByRole("button", { name: "Send for approval" }).click();
  await expect(nour.locator("[role=status]", { hasText: "Sent for approval" })).toBeVisible();
  await expect(nour.getByRole("heading", { name: "Boost the masterclass reel" })).toBeVisible();
  await scan(nour, "request page");

  // Mo (finance) approves from the inbox in one click
  const mo = await (await browser.newContext()).newPage();
  await signIn(mo, "mo@orladent.local");
  await mo.goto("/inbox");
  await mo.getByRole("button", { name: "Approve: Nour asks: Boost the masterclass reel" }).click();
  await expect(mo.locator("[role=status]", { hasText: "Approved" })).toBeVisible();
  await mo.goto("/approvals");
  await expect(mo.locator("main")).toContainText("Nothing waiting for you");
  await scan(mo, "approvals queue");

  // Nour sees the answer and the history
  await nour.goto("/approvals?tab=mine");
  await nour.getByRole("link", { name: "Boost the masterclass reel" }).click();
  await expect(nour.locator("main")).toContainText("Approved");
  await expect(nour.locator("main")).toContainText(/Mo\s+approved/);
  await expect(nour.locator("main")).toContainText("This history cannot be edited or deleted.");
});
