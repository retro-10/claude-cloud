import { expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-password-1";

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
  await expect(page.locator("h1").first()).toBeVisible();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Text of a dashboard KPI card, e.g. stat(page, "Leads") -> "Leads 20". */
export async function stat(page: Page, label: string) {
  await page.goto("/dashboard?all=1");
  return (await page.locator(`div:has(> div:text-is("${label}"))`).first().innerText()).replace(/\s+/g, " ");
}
