import { expect, test } from "@playwright/test";
import { signIn, stat } from "./helpers";

test("owner takes a lead from first message to enrolment and sees it on the dashboard", async ({ page }) => {
  await signIn(page, "retro@orladent.local");

  const leadsBefore = await stat(page, "Leads");
  const revenueBefore = await stat(page, "Revenue");
  expect(leadsBefore).toBe("Leads 20"); // the 20-lead demo dataset
  expect(revenueBefore).toContain("60,000 EGP");

  // 1. add a lead (keyboard shortcut) with an Arabic name
  await page.goto("/leads");
  await page.keyboard.press("n");
  await page.fill("input[name=fullName]", "ياسمين فؤاد");
  await page.fill("input[name=phone]", "0100 777 6655");
  await page.click("[role=dialog] button:has-text('Add lead')");
  await expect(page.locator("h1", { hasText: "ياسمين فؤاد" })).toBeVisible();
  await expect(page.locator("text=waiting").first()).toBeVisible(); // speed-to-lead badge

  // 2. a duplicate of the same number (different format) is refused with a link back
  await page.goto("/leads");
  await page.keyboard.press("n");
  await page.fill("input[name=fullName]", "Someone else");
  await page.fill("input[name=phone]", "+20 100 777 6655");
  await page.click("[role=dialog] button:has-text('Add lead')");
  await expect(page.locator("[role=dialog] [role=alert]")).toContainText("already exists");
  await page.click("[role=dialog] a:has-text('Open')");
  await expect(page.locator("h1", { hasText: "ياسمين فؤاد" })).toBeVisible();

  // 3. log the first WhatsApp: the waiting badge goes away
  await page.selectOption("select[name=type]", "whatsapp");
  await page.selectOption("select[name=direction]", "out");
  await page.fill("textarea[name=body]", "أهلاً ياسمين");
  await page.click("button:has-text('Log activity')");
  await expect(page.locator("li", { hasText: "أهلاً ياسمين" })).toBeVisible();
  await expect(page.locator("text=waiting")).toHaveCount(0);

  // 4. book a consult for tomorrow, then record it as held with two objections
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) + "T16:30";
  const book = page.locator("form:has(input[name=confirmed])");
  await book.locator("input[name=when]").fill(tomorrow);
  await book.locator("button").click();
  await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();
  await page.click("summary:has-text('Record result')");
  await page.locator("form:has(button:has-text('Save result')) select[name=outcome]").selectOption("enrolled");
  await page.check("input[name=objectionIds] >> nth=0");
  await page.check("input[name=objectionIds] >> nth=2");
  await page.click("button:has-text('Save result')");
  await expect(page.getByText("Held · enrolled", { exact: true })).toBeVisible();

  // 5. enrol from the pipeline (Freelance Ready, list price pre-filled)
  await page.goto("/pipeline");
  await page.locator("li", { hasText: "ياسمين فؤاد" }).locator("select").selectOption({ label: "Enrolled" });
  await expect(page.locator("[role=dialog]", { hasText: "Enrol student" })).toBeVisible();
  await page.locator("[role=dialog] select").first().selectOption({ index: 0 });
  await page.locator("[role=dialog] select").nth(1).selectOption("freelance_ready");
  await expect(page.locator("[role=dialog] input[inputmode=numeric]")).toHaveValue("15000");
  // exit criterion for Enrolled: no payment reference, no enrolment
  await page.click("[role=dialog] button:text-is('Enrol')");
  await expect(page.locator("[role=dialog] [role=alert]")).toContainText("Payment confirmed with a reference");
  await page.fill("[role=dialog] input[placeholder='Paymob transaction id']", "PMB-778899");
  await page.click("[role=dialog] button:text-is('Enrol')");
  await expect(page.locator("[role=dialog]")).toHaveCount(0);
  await expect(page.locator("section[aria-label='Enrolled']", { hasText: "ياسمين فؤاد" })).toBeVisible();

  // 6. the dashboard moved by exactly this lead
  expect(await stat(page, "Leads")).toBe("Leads 21");
  expect(await stat(page, "Revenue")).toContain("75,000 EGP"); // 60,000 + 15,000
  await page.goto("/dashboard?all=1");
  await expect(page.locator("section[aria-label='Funnel'] li", { hasText: "Enrolled" })).toContainText("6");
});

test("a new user is nagged to set a password, changes it, is signed out, and the old password stops working", async ({ page }) => {
  await signIn(page, "sayed@orladent.local"); // an owner
  await page.goto("/settings/users");
  const form = page.locator("form:has(h2:has-text('Add a user'))");
  await form.locator("input[name=name]").fill("Nada Sales");
  await form.locator("input[name=email]").fill("nada@orladent.local");
  await form.locator("select[name=role]").selectOption("sales");
  await form.locator("input[name=password]").fill("first password 1");
  await form.locator("button:has-text('Create user')").click();
  await expect(page.locator("[role=status]", { hasText: "Saved" })).toBeVisible();
  await expect(page.locator("li", { hasText: "nada@orladent.local" })).toContainText("initial password");

  await page.context().clearCookies();
  await signIn(page, "nada@orladent.local", "first password 1");
  await expect(page.locator("[role=status]", { hasText: "initial password" })).toBeVisible();
  await expect(page.locator("nav a:has-text('Settings')")).toHaveCount(0); // sales: no settings link
  await page.goto("/settings/users");
  await expect(page.locator("h1", { hasText: "Not found" })).toBeVisible(); // no error page, no data

  await page.goto("/account");
  await page.fill("input[name=current]", "first password 1");
  await page.fill("input[name=next]", "second password 2");
  await page.fill("input[name=confirm]", "second password 2");
  await page.click("button:has-text('Change password')");
  await page.waitForURL("**/login");

  await page.fill("input[name=email]", "nada@orladent.local");
  await page.fill("input[name=password]", "first password 1");
  await page.click("button[type=submit]");
  await expect(page.locator("form [role=alert]")).toContainText("Wrong email or password");
  await signIn(page, "nada@orladent.local", "second password 2");
  await expect(page.locator("[role=status]", { hasText: "initial password" })).toHaveCount(0);
});

test("release 1.1: command palette, template message with confirm, exit criteria on the board, done with next step", async ({ page, context }) => {
  await context.route("https://wa.me/**", (r) => r.fulfill({ status: 200, body: "whatsapp" })); // never leave the sandbox
  await signIn(page, "retro@orladent.local");

  // Ctrl+K finds a lead by a local-format phone number and opens it
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await expect(page.locator("[role=dialog][aria-label='Command palette']")).toBeVisible();
  await page.keyboard.type("0108 000 0016");
  await expect(page.locator("[role=option]", { hasText: "Demo Lead 16" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("h1", { hasText: "Demo Lead 16" })).toBeVisible();

  // template -> WhatsApp opens with the text -> "Yes, log it" puts it on the timeline
  await page.locator("main button:has-text('WhatsApp')").first().click();
  const composer = page.locator("[role=dialog][aria-labelledby=composer-title]");
  await expect(composer).toBeVisible();
  await composer.locator("[role=tab]:has-text('English')").click();
  await composer.locator("button:has-text('First reply')").click();
  await expect(composer.locator("textarea")).toHaveValue(/^Hi Demo, thanks for reaching out/);
  const [popup] = await Promise.all([page.waitForEvent("popup"), composer.locator("a:has-text('Open in WhatsApp')").click()]);
  expect(decodeURIComponent(popup.url())).toContain("wa.me/201080000016?text=Hi Demo");
  await popup.close();
  await composer.locator("button:has-text('Yes, log it as sent')").click();
  await expect(page.locator("li", { hasText: "Hi Demo, thanks for reaching out" }).first()).toBeVisible();

  // a missing placeholder blocks sending
  await page.locator("main button:has-text('WhatsApp')").first().click();
  await composer.locator("[role=tab]:has-text('English')").click();
  await composer.locator("button:has-text('Post-consult recap')").click();
  await expect(composer.locator("[role=alert]")).toContainText("{payment_link}");
  await expect(composer.locator("a:has-text('Open in WhatsApp')")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  // board: Consult held -> Offer sent lists what is missing; owner can override with a reason
  await page.goto("/pipeline");
  await page.locator("li", { hasText: "Demo Lead 12" }).locator("select").selectOption({ label: "Offer sent" });
  const dialog = page.locator("[role=dialog]");
  await expect(dialog).toContainText(/Not ready|Next step/);
  if (await dialog.locator("input[type=date]").count()) await dialog.locator("input[type=date]").fill("2030-01-10");
  await dialog.locator("button:text-is('Move')").click();
  await expect(dialog.locator("[role=alert]")).toContainText("Decision date agreed");
  await dialog.locator("textarea").fill("Agreed on the phone");
  await dialog.locator("button:has-text('Move anyway')").click();
  await expect(page.locator("section[aria-label='Offer sent']", { hasText: "Demo Lead 12" })).toBeVisible();

  // Today: "Done" asks for the next step in the same click
  await page.goto("/");
  const before = await page.locator("#overdue li").count();
  expect(before).toBeGreaterThan(0);
  const row = page.locator("#overdue li").first();
  await row.locator("summary:has-text('Done')").click();
  await row.locator("details:has(summary:has-text('Done')) button:has-text('In 3 days')").click();
  await expect(page.locator("#overdue li")).toHaveCount(before - 1);
});
