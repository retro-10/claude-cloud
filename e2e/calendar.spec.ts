import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ready, signIn } from "./helpers";

// The team calendar: clock in and out from the top bar, see who is working, plan events everyone can see, and
// fix hours by hand. Mo (finance, not an owner) is used: an ordinary member who manages only their own calendar.
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function scan(page: Page, label: string) {
  for (const t of ["dark", "light"]) {
    await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")})`), `${label} (${t})`).toEqual([]);
  }
}

/** Today's date (Cairo) as YYYY-MM-DD, and another day of the same Monday-to-Sunday week. */
function cairoDays() {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const weekday = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;
  const other = new Date(Date.parse(`${ymd}T00:00:00Z`) + (weekday < 6 ? 1 : -1) * 86_400_000).toISOString().slice(0, 10);
  return { today: ymd, other };
}

test("team calendar: clock in and out, plan events, everyone sees them, fix hours by hand", async ({ page }) => {
  test.setTimeout(150_000);
  const { today, other } = cairoDays();
  await signIn(page, "mo@orladent.local");
  await page.goto("/calendar");
  await ready(page);
  await scan(page, "team calendar");

  // clock in from the top bar; the button turns into a running timer and "Right now" shows Mo working
  await page.getByRole("banner").getByRole("button", { name: "Clock in" }).click();
  await expect(page.locator("[role=status]", { hasText: "Clocked in" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: /Working/ })).toBeVisible();
  const right = page.getByRole("region", { name: "Right now" });
  await expect(right.locator(".card", { hasText: "Mo" })).toContainText("Working");

  // a meeting today and a day off later this week: both in the week grid and in Coming up
  await page.getByLabel("What").fill("Supplier call");
  await page.getByLabel("Starts").fill(`${today}T23:00`);
  await page.getByLabel("Ends").fill(`${today}T23:45`);
  await page.getByRole("button", { name: "Add event" }).click();
  await expect(page.locator("[role=status]", { hasText: "Added to the calendar" })).toBeVisible();
  await page.getByLabel("What").fill("Day off");
  await page.getByLabel("Kind").selectOption({ label: "Day off / leave" });
  await page.getByLabel(/All day/).check();
  await page.getByLabel("Starts").fill(`${other}T00:00`);
  await page.getByLabel("Ends").fill(`${other}T00:00`);
  await page.getByRole("button", { name: "Add event" }).click();
  await expect(page.locator("[role=status]", { hasText: "Added to the calendar" })).toBeVisible();
  const week = page.locator("main table").first();
  const moRow = week.locator("tr", { has: page.locator("th", { hasText: /^Mo$/ }) });
  await expect(moRow).toContainText("Supplier call");
  await expect(moRow).toContainText("Day off");
  await expect(moRow).toContainText("All day");
  await scan(page, "team calendar with events");

  // edit the meeting from its chip
  await moRow.getByRole("link", { name: /Supplier call/ }).click();
  await expect(page.getByRole("heading", { name: "Edit event" })).toBeVisible();
  await page.getByLabel("What").fill("Supplier call (moved)");
  await page.getByRole("button", { name: "Save event" }).click();
  await expect(page.locator("[role=status]", { hasText: "Event saved" })).toBeVisible();
  await expect(moRow).toContainText("Supplier call (moved)");

  // another person sees Mo's plans and status, but cannot edit them
  const other2 = await page.context().browser()!.newContext({ reducedMotion: "reduce" });
  const sayed = await other2.newPage();
  await signIn(sayed, "badr@orladent.local");
  await sayed.goto("/calendar");
  await expect(sayed.getByRole("region", { name: "Right now" }).locator(".card", { hasText: "Mo" })).toContainText("Working");
  await expect(sayed.locator("tr", { has: sayed.locator("th", { hasText: /^Mo$/ }) })).toContainText("Supplier call (moved)");
  await other2.close();

  // My time: clock out with a note; the stretch is listed with its length
  await page.getByRole("link", { name: "My time" }).click();
  await ready(page);
  await scan(page, "my time");
  await page.getByLabel("What are you working on? (optional)").fill("Month-end close");
  await page.getByRole("main").getByRole("button", { name: "Clock out" }).click();
  await expect(page.locator("[role=status]", { hasText: "Clocked out" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Clock in" })).toBeVisible();
  await expect(page.locator("main table").first()).toContainText("Month-end close");

  // hours by hand: refused when they overlap, accepted otherwise
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  await page.getByRole("textbox", { name: "From", exact: true }).fill(`${yesterday}T09:00`);
  await page.getByRole("textbox", { name: "To", exact: true }).fill(`${yesterday}T08:00`);
  await page.getByRole("button", { name: "Add hours" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("after the start");
  await page.getByRole("textbox", { name: "From", exact: true }).fill(`${yesterday}T09:00`);
  await page.getByRole("textbox", { name: "To", exact: true }).fill(`${yesterday}T13:30`);
  await page.getByLabel("Note (optional)").first().fill("Bank visit");
  await page.getByRole("button", { name: "Add hours" }).click();
  await expect(page.locator("[role=status]", { hasText: "Hours added" })).toBeVisible();
  await page.getByRole("textbox", { name: "From", exact: true }).fill(`${yesterday}T10:00`);
  await page.getByRole("textbox", { name: "To", exact: true }).fill(`${yesterday}T11:00`);
  await page.getByRole("button", { name: "Add hours" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("overlaps");

  // payroll: finance downloads the month's hours, a total per person
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await ready(page);
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Total per person (CSV)" }).click()]);
  expect(file.suggestedFilename()).toMatch(/^hours-\d{4}-\d{2}-summary\.csv$/);
  const csv = await (await file.createReadStream()).toArray().then((b) => Buffer.concat(b).toString("utf8"));
  expect(csv.split("\n")[0]).toContain("person,email,role,month,hours");
  expect(csv).toContain("Mo,mo@orladent.local");
});
