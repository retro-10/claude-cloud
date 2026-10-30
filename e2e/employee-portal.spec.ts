import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { base32Decode, hotp, stepAt } from "../src/lib/totp";
import { ready, signIn } from "./helpers";

// The employee portal: two-factor required; an owner fills in a record and adds a contract; the person accepts it
// and asks for a change; finance sees pay terms only. Fresh users, so two-factor stays off for the seeded ones.
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

/** Turns on two-factor for the signed-in person (the code is used once, at setup). */
async function turnOnTwoFactor(page: Page) {
  await page.goto("/account");
  await ready(page);
  await page.click("button:has-text('Set up two-factor sign-in')");
  const key = (await page.locator("#two-factor code").innerText()).replace(/\s/g, "");
  await page.fill("#two-factor input[name=code]", hotp(base32Decode(key), stepAt(Date.now())));
  await page.click("#two-factor button:has-text('Turn on')");
  await expect(page.locator("#two-factor")).toContainText("recovery codes");
}

test("employee records: two-factor first; a contract is added and accepted; a change is asked and made; finance sees pay only", async ({ browser }) => {
  test.setTimeout(180_000);
  const retro = await (await browser.newContext()).newPage();
  await signIn(retro, "retro@orladent.local");
  await retro.goto("/settings/users");
  const add = retro.locator("form", { hasText: "Add a user" });
  for (const [name, email, role] of [
    ["Hana", "hana@orladent.local", "owner"],
    ["Karim", "karim@orladent.local", "sales"],
    ["Farida", "farida@orladent.local", "finance"],
  ]) {
    await add.getByLabel("Name").fill(name);
    await add.getByLabel("Email").fill(email);
    await add.getByLabel("Role").selectOption(role);
    await add.getByLabel(/Initial password/).fill("portal-pass-123");
    await retro.getByRole("button", { name: "Create user" }).click();
    await expect(retro.locator("main")).toContainText(email);
  }

  // without two-factor the portal says what to do, and the records stay closed
  const karim = await (await browser.newContext()).newPage();
  await signIn(karim, "karim@orladent.local", "portal-pass-123");
  await karim.getByRole("navigation").first().getByRole("link", { name: "My portal" }).click();
  await expect(karim.getByRole("heading", { name: "Turn on two-factor sign-in first" })).toBeVisible();
  await scan(karim, "two-factor gate");

  // Hana (owner) turns on two-factor, fills in Karim's record and adds his contract
  const hana = await (await browser.newContext()).newPage();
  await signIn(hana, "hana@orladent.local", "portal-pass-123");
  await turnOnTwoFactor(hana);
  await hana.goto("/employees");
  await scan(hana, "employees");
  await hana.getByRole("link", { name: "Karim" }).click();
  await hana.getByLabel("Job title").fill("Sales lead");
  await hana.getByLabel("Start date").fill("2026-01-04");
  await hana.getByLabel("Pay terms").fill("Monthly salary");
  await hana.getByLabel("Pay (EGP)").fill("15000");
  await hana.getByRole("button", { name: "Create the record" }).click();
  await expect(hana.locator("[role=status]", { hasText: "Record saved" })).toBeVisible();
  await hana.getByLabel("Title", { exact: true }).fill("Employment contract");
  await hana.locator("form", { hasText: "Add the document" }).getByLabel("Document", { exact: true }).setInputFiles({ name: "contract.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await hana.getByRole("button", { name: "Add the document" }).click();
  await expect(hana.locator("[role=status]", { hasText: "Document added" })).toBeVisible();
  await expect(hana.locator("main")).toContainText("Not accepted");
  await scan(hana, "employee record");

  // Karim turns on two-factor; his portal shows the record and the contract to accept
  await turnOnTwoFactor(karim);
  await karim.goto("/me");
  await expect(karim.locator("main")).toContainText("Sales lead");
  await expect(karim.locator("main")).toContainText("1 document to read and accept");
  await scan(karim, "my portal");
  await karim.getByLabel("Phone", { exact: true }).fill("0100 123 4567");
  await karim.getByRole("button", { name: "Save contact details" }).click();
  await expect(karim.locator("[role=status]", { hasText: "Contact details saved" })).toBeVisible();
  await karim.getByRole("link", { name: "Employment contract" }).click();
  const res = await karim.request.get((await karim.getByRole("link", { name: /Download contract\.pdf/ }).getAttribute("href"))!);
  expect(res.status()).toBe(200);
  await karim.getByLabel(/I have read this document/).check();
  await karim.getByRole("button", { name: "Record my acceptance" }).click();
  await expect(karim.locator("[role=status]", { hasText: "read and accepted" })).toBeVisible();
  await expect(karim.locator("main")).toContainText("You read and accepted version 1");
  await scan(karim, "document");

  // he asks for a pay change; Hana makes it
  await karim.goto("/me");
  await karim.getByText("Ask to change my details").click();
  await karim.getByLabel("What").selectOption("payAmountEgp");
  await karim.getByLabel("Should be").fill("18000");
  await karim.getByRole("button", { name: "Send to the owners" }).click();
  await expect(karim.locator("[role=status]", { hasText: "Sent to the owners" })).toBeVisible();
  await hana.reload();
  await expect(hana.locator("main")).toContainText("Phone");
  await expect(hana.locator("main")).toContainText("0100 123 4567");
  await hana.getByRole("button", { name: "Send", exact: true }).click();
  await expect(hana.locator("[role=status]", { hasText: "Change made" })).toBeVisible();
  await expect(hana.getByLabel("Pay (EGP)")).toHaveValue("18000");

  // a stranger's request for the contract file is refused
  const href = (await hana.locator("main a[href^='/me/documents/']").first().getAttribute("href"))!;
  const farida = await (await browser.newContext()).newPage();
  await signIn(farida, "farida@orladent.local", "portal-pass-123");
  await turnOnTwoFactor(farida);
  expect((await farida.goto(href))!.status()).toBe(404);

  // finance: pay terms only, no record pages
  await farida.goto("/hq");
  await farida.getByRole("navigation").first().getByRole("link", { name: "Pay terms" }).click();
  await expect(farida.getByRole("heading", { name: "Pay terms" })).toBeVisible();
  const row = farida.locator("tr", { hasText: "Karim" });
  await expect(row).toContainText("Monthly salary");
  await expect(row).toContainText("18,000");
  await expect(farida.locator("main")).not.toContainText("Sales lead");
  await expect(farida.locator("main a[href^='/employees/']")).toHaveCount(0);
  await scan(farida, "pay terms");
  expect((await farida.goto("/employees/1"))!.status()).toBe(404);
});
