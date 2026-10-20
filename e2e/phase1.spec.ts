import { expect, test } from "@playwright/test";
import { base32Decode, hotp, stepAt } from "../src/lib/totp";
import { ready, signIn } from "./helpers";

// OrlaDent OS, Phase 1, in a real browser against the built app.

test("command centre, targets, a task from creation to done, the offer builder and a file on a lead", async ({ page, context }) => {
  await context.route("https://wa.me/**", (r) => r.fulfill({ status: 200, body: "whatsapp" }));
  await signIn(page, "retro@orladent.local");

  // targets set in Settings show on the Command centre
  await page.goto("/settings/targets");
  await ready(page);
  const q = page.locator("form").filter({ has: page.locator("button", { hasText: /Save \d{4}-Q\d/ }) }).first();
  await q.locator("input[name=leads]").fill("500");
  await q.locator("button", { hasText: /Save/ }).click();
  await expect(page.locator("[role=status]", { hasText: "saved" })).toBeVisible();
  await page.goto("/command");
  await ready(page);
  await expect(page.locator("h1", { hasText: "Command centre" })).toBeVisible();
  await expect(page.locator("section[aria-label='Pulse, last 7 days']")).toContainText("New leads");
  await expect(page.locator("[role=progressbar][aria-label^='New leads']")).toBeVisible();

  // a task: add it for myself, see it counted in the sidebar, finish it
  await page.goto("/tasks");
  await ready(page);
  await page.fill("input[name=title]", "Book the studio for the masterclass");
  await page.selectOption("select[name=priority]", "high");
  await page.click("form button:has-text('Add task')");
  await expect(page.locator("[role=status]", { hasText: "Task added" })).toBeVisible();
  const task = page.locator("li", { hasText: "Book the studio for the masterclass" });
  await expect(task).toContainText("high");
  await expect(page.locator("nav a[href='/tasks'] .count")).toHaveText("1");
  await task.locator("button[title='Mark done']").click();
  await expect(page.locator("li", { hasText: "Book the studio for the masterclass" })).toHaveCount(0);
  await page.goto("/tasks?who=done");
  await expect(page.locator("li", { hasText: "Book the studio for the masterclass" })).toBeVisible();

  // the offer builder, opened from a lead: schedule, message, saved on the lead
  await page.goto("/leads");
  await ready(page);
  const leadHref = (await page.locator("tbody a[href^='/leads/']").first().getAttribute("href"))!;
  await page.goto(`/tools/offer?lead=${leadHref.split("/").pop()}`);
  await ready(page);
  await page.selectOption("select >> nth=0", "freelance_ready");
  await page.getByLabel("Discount (EGP)").fill("1000");
  await page.getByLabel("Instalments", { exact: true }).check();
  await page.getByLabel("Deposit now (EGP)").fill("4000");
  await expect(page.locator("table")).toContainText("Instalment 2 of 2");
  await expect(page.locator("textarea")).toHaveValue(/Price: 14,000 EGP/);
  await page.locator("button", { hasText: /Save offer on/ }).click();
  await page.waitForURL(`**${leadHref}?notice=*`);
  await expect(page.locator("[role=status]", { hasText: "Offer saved" })).toBeVisible();

  // a file on that lead: upload, listed, downloadable
  await page.locator("section[aria-label='Files'] input[type=file]").setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await page.locator("section[aria-label='Files'] button", { hasText: "Upload" }).click();
  await expect(page.locator("[role=status]", { hasText: "File added" })).toBeVisible();
  const link = page.locator("section[aria-label='Files'] a", { hasText: "receipt.pdf" });
  const res = await page.request.get((await link.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain("attachment");
});

test("two-factor: set up with a code from the app, then signing in needs the password and a code", async ({ page }) => {
  await signIn(page, "badr@orladent.local");
  await page.goto("/account");
  await ready(page);
  await page.click("button:has-text('Set up two-factor sign-in')");
  const key = (await page.locator("#two-factor code").innerText()).replace(/\s/g, "");
  const code = (ms: number) => hotp(base32Decode(key), stepAt(ms));
  await page.fill("#two-factor input[name=code]", code(Date.now()));
  await page.click("#two-factor button:has-text('Turn on')");
  await expect(page.locator("#two-factor")).toContainText("recovery codes");
  await expect(page.locator("#two-factor ul li")).toHaveCount(10);
  await page.click("#two-factor a:has-text('saved them')");
  await expect(page.locator("#two-factor")).toContainText("10 recovery codes left");

  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("input[name=email]", "badr@orladent.local");
  await page.fill("input[name=password]", "e2e-password-1");
  await page.click("button[type=submit]");
  await page.waitForURL("**/login/verify");
  await expect(page.locator("h1")).toHaveText("Two-factor sign-in");
  // nothing inside the app opens with only the password
  await page.goto("/command");
  await page.waitForURL("**/login");
  await page.fill("input[name=email]", "badr@orladent.local");
  await page.fill("input[name=password]", "e2e-password-1");
  await page.click("button[type=submit]");
  await page.waitForURL("**/login/verify");
  await page.fill("input[name=code]", "000000");
  await page.click("button:has-text('Continue')");
  await expect(page.locator("form [role=alert]")).toContainText("did not match");
  await page.fill("input[name=code]", code(Date.now() + 30_000)); // the setup used this 30 seconds' code
  await page.click("button:has-text('Continue')");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/account");
  await expect(page.locator("#two-factor")).toContainText("On since");
});
