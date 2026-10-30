import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Announcements with acknowledgement, the people directory, and the brand hub's asset library with versions.
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

// a 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

test("a must-read announcement is acknowledged and tracked; the directory; the brand library with versions", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, "badr@orladent.local");
  await owner.goto("/announcements/new");
  await scan(owner, "new announcement");
  await owner.getByLabel("Title").fill("Updated refund policy");
  await owner.getByLabel(/^Message/).fill("Refunds are possible within **7 days** of the first class.");
  await owner.getByLabel(/Must read/).check();
  await owner.getByRole("button", { name: "Send" }).click();
  await expect(owner.locator("[role=status]", { hasText: /^Sent to \d+ people/ })).toBeVisible();
  await scan(owner, "announcement (author)");

  // Mo sees the banner on HQ home, reads and acknowledges
  const mo = await (await browser.newContext()).newPage();
  await signIn(mo, "mo@orladent.local");
  await mo.goto("/hq");
  await mo.getByRole("status").getByRole("link", { name: "Updated refund policy" }).click();
  await expect(mo.locator("main strong", { hasText: "7 days" })).toBeVisible();
  await mo.getByRole("button", { name: "I have read it" }).click();
  await expect(mo.locator("[role=status]", { hasText: "acknowledged" })).toBeVisible();
  await mo.goto("/announcements");
  await expect(mo.locator("main")).toContainText("Acknowledged");
  await scan(mo, "announcements feed");

  // the author sees who acknowledged
  await owner.reload();
  await expect(owner.locator("main")).toContainText(/acknowledged by 2/); // the author and Mo

  // the directory: everyone, and a message button
  await mo.goto("/people");
  await scan(mo, "people");
  await mo.getByRole("button", { name: "Message Badr" }).click();
  await expect(mo.getByRole("heading", { name: "Chat: Badr" })).toBeAttached();

  // the brand hub: add a logo, everyone downloads it, a new version retires the old one
  await owner.goto("/brand/assets/new");
  await scan(owner, "new asset");
  await owner.getByLabel("Name").fill("Camp logo");
  await owner.getByLabel("Version (optional)").fill("2025");
  await owner.getByLabel(/^Tags/).fill("camp, core");
  await owner.getByLabel(/^File/).setInputFiles({ name: "camp-logo.png", mimeType: "image/png", buffer: PNG });
  await owner.getByRole("button", { name: "Add to the library" }).click();
  await expect(owner.locator("[role=status]", { hasText: "Added to the library" })).toBeVisible();
  const firstUrl = owner.url();
  await scan(owner, "asset page");

  await mo.goto("/brand");
  await scan(mo, "brand hub");
  const card = mo.locator("main li", { hasText: "Camp logo" });
  const [download] = await Promise.all([mo.waitForEvent("download"), card.getByRole("link", { name: "Download" }).click()]);
  expect(download.suggestedFilename()).toBe("camp-logo.png");

  await owner.getByLabel("Version", { exact: true }).fill("2026");
  await owner.locator("form", { hasText: "Add the new version" }).getByLabel("File").setInputFiles({ name: "camp-logo-2026.png", mimeType: "image/png", buffer: PNG });
  await owner.getByRole("button", { name: "Add the new version" }).click();
  await expect(owner.locator("[role=status]", { hasText: "the old one is retired" })).toBeVisible();
  await expect(owner.locator("main")).toContainText("0 downloads"); // the new version starts its own count
  await owner.goto(firstUrl);
  await expect(owner.locator("main")).toContainText("This version is retired");
  await mo.goto("/brand");
  await expect(mo.locator("main li", { hasText: "Camp logo" })).toHaveCount(1);
  await expect(mo.locator("main li", { hasText: "Camp logo" })).toContainText("v2026");
});
