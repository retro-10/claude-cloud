import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, ready, signIn } from "./helpers";

// OrlaDent OS, Phase 4 (production studio, team and money), in a real browser against the built app.
test.use({ contextOptions: { reducedMotion: "reduce" } });

async function scan(page: Page, label: string) {
  for (const t of ["dark", "light"]) {
    await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")})`), `${label} (${t})`).toEqual([]);
  }
}

test("a production case end to end: price list, client, a designer who sees only their case, QC, delivery, invoice, payment and receipt", async ({ page, browser }) => {
  await signIn(page, "sayed@orladent.local");

  // the price list and a client
  await page.goto("/production/prices");
  await ready(page);
  const add = page.locator("form").filter({ has: page.locator("button", { hasText: "Add to the price list" }) });
  await add.locator("input[name=name]").fill("Zirconia crown");
  await add.locator("input[name=unitPriceEgp]").fill("1000");
  await add.locator("input[name=designerPayEgp]").fill("400");
  await add.locator("textarea[name=qcChecklist]").fill("Margins\nContacts");
  await add.locator("button").click();
  await expect(page.locator("main")).toContainText("Zirconia crown");
  await page.goto("/production/clients");
  await page.fill("input[name=name]", "Cairo Smile Clinic");
  await page.fill("input[name=discountPct]", "10");
  await page.fill("input[name=paymentTermsDays]", "7");
  await page.click("button:has-text('Add client')");
  await page.waitForURL("**/production/clients/*");

  // a designer account
  await page.goto("/settings/users");
  const newUser = page.locator("form").filter({ has: page.locator("button", { hasText: "Create user" }) });
  await newUser.locator("input[name=name]").fill("Dina Designer");
  await newUser.locator("input[name=email]").fill("dina@orladent.local");
  await newUser.locator("select[name=role]").selectOption("designer");
  await newUser.locator("input[name=password]").fill(PASSWORD);
  await newUser.locator("button").click();
  await expect(page.locator("main")).toContainText("dina@orladent.local");

  // take a case in for her: 2 units at 1,000 less 10% = 1,800 EGP
  await page.goto("/production");
  const intake = page.locator("form").filter({ has: page.locator("button", { hasText: "Take it in" }) });
  await intake.locator("select[name=clientId]").selectOption({ label: "Cairo Smile Clinic (−10%)" });
  await intake.locator("select[name=caseTypeId]").selectOption({ label: "Zirconia crown" });
  await intake.locator("input[name=units]").fill("2");
  await intake.locator("input[name=reference]").fill("Dr Samir job 88");
  await intake.locator("select[name=designerId]").selectOption({ label: "Dina Designer" });
  await intake.locator("button").click();
  await page.waitForURL("**/production/cases/*");
  const caseUrl = new URL(page.url()).pathname;
  await expect(page.locator("main")).toContainText("1,800 EGP");
  await scan(page, "case page");

  // the designer: only the studio, only her case
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const dina = await ctx.newPage();
  await signIn(dina, "dina@orladent.local");
  await expect(dina).toHaveURL(/\/production$/);
  await expect(dina.locator("nav[aria-label=Main]")).not.toContainText("Leads");
  await expect(dina.locator("main")).toContainText("Cairo Smile Clinic");
  await expect(dina.locator("main")).not.toContainText("1,800");
  await scan(dina, "designer's board");
  await dina.goto(caseUrl);
  await dina.click("button:has-text('Start designing')");
  await expect(dina.locator("[role=status]", { hasText: "Started" })).toBeVisible();
  await dina.locator("input[type=file]").setInputFiles({ name: "crown.stl", mimeType: "model/stl", buffer: Buffer.from("solid crown\nendsolid crown\n") });
  await dina.click("button:has-text('Upload')");
  await expect(dina.locator("main")).toContainText("crown.stl");
  await dina.click("button:has-text('Send to QC')");
  await expect(dina.locator("[role=status]", { hasText: "Sent to QC" })).toBeVisible();
  // no lead list for her
  const res = await dina.goto("/leads");
  expect(res?.status()).toBe(404);
  await ctx.close();

  // QC: one item wrong sends it back; then it passes and is delivered
  await page.goto(caseUrl);
  await page.getByLabel("Margins").check();
  await page.fill("textarea[name=note]", "Close the mesial contact");
  await page.click("button:has-text('Save the QC result')");
  await expect(page.locator("[role=status]", { hasText: "Sent back to the designer" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Close the mesial contact");
  // (the designer would fix it and send it again; an owner can do that step too)
  await page.click("button:has-text('Send to QC')");
  await page.getByLabel("Margins").check();
  await page.getByLabel("Contacts").check();
  await page.click("button:has-text('Save the QC result')");
  await expect(page.locator("[role=status]", { hasText: "QC passed" })).toBeVisible();
  await page.click("button:has-text('Mark delivered to the client')");
  await expect(page.locator("[role=status]", { hasText: "Delivered" })).toBeVisible();

  // finance: invoice, a part payment, the receipt
  const fctx = await browser.newContext({ reducedMotion: "reduce" });
  const mo = await fctx.newPage();
  await signIn(mo, "mo@orladent.local");
  await mo.goto("/production/invoices");
  await mo.locator("li", { hasText: "Cairo Smile Clinic" }).locator("button", { hasText: "Invoice" }).click();
  await mo.waitForURL("**/production/invoices/*");
  await expect(mo.locator("h1")).toHaveText(/^INV-\d{4}-\d{4}$/);
  await expect(mo.locator("main")).toContainText("1,800 EGP");
  await mo.fill("input[name=amountEgp]", "1000");
  await mo.click("button:has-text('Record payment')");
  await expect(mo.locator("[role=status]", { hasText: "800 EGP still owed" })).toBeVisible();
  await scan(mo, "invoice page");
  const receipt = await mo.locator("a", { hasText: "Receipt" }).first().getAttribute("href");
  await mo.goto(receipt!);
  await expect(mo.locator("main")).toContainText("Cairo Smile Clinic");
  await expect(mo.locator("main")).toContainText("1,000 EGP");
  await fctx.close();
});

test("every Phase 4 screen has no accessibility violations, in both themes", async ({ page }) => {
  await signIn(page, "sayed@orladent.local");
  for (const path of [
    "/production",
    "/production/clients",
    "/production/prices",
    "/production/designers",
    "/production/quote",
    "/production/invoices",
    "/team",
    "/team/sops",
    "/team/runs",
    "/team/meetings",
    "/team/decisions",
    "/finance/budget",
    "/finance/forecast",
    "/finance/economics",
    "/tools/pricing",
    "/settings/finance",
  ]) {
    await page.goto(path);
    await ready(page);
    await expect(page.locator("h1").first()).toBeVisible();
    await scan(page, path);
  }
});
