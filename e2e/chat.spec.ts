import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ready, signIn } from "./helpers";

// Team chat between two people in two browsers: Mo (finance) and Badr (an owner). Messages, mentions, edits and
// direct messages reach the other window through the conversation's poll, without reloading.
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

const log = (page: Page) => page.getByRole("log", { name: "Messages" });
async function send(page: Page, text: string) {
  const box = page.getByLabel("Message", { exact: true });
  await box.fill(text);
  await box.press("Enter");
  await expect(box).toHaveValue("");
}

test("team chat: channels, live messages, mentions, edits and direct messages", async ({ browser }) => {
  test.setTimeout(180_000);
  const mo = await (await browser.newContext()).newPage();
  const badr = await (await browser.newContext()).newPage();
  await signIn(mo, "mo@orladent.local");
  await signIn(badr, "badr@orladent.local");

  // Mo opens #general from the sidebar and writes to the team
  await mo.getByRole("navigation").getByRole("link", { name: "Chat" }).first().click();
  await expect(mo).toHaveURL(/\/chat$/);
  await scan(mo, "chat home");
  await mo.getByRole("navigation", { name: "Conversations" }).getByRole("link", { name: "general" }).click();
  await expect(mo).toHaveURL(/\/chat\/\d+$/);
  const general = mo.url();
  await ready(mo);
  await send(mo, "Morning team, the **new batch** opens Sunday: https://orladent.com/camp");
  await expect(log(mo).locator("strong", { hasText: "new batch" })).toBeVisible();
  await expect(log(mo).getByRole("link", { name: "https://orladent.com/camp" })).toHaveAttribute("rel", "noopener noreferrer");
  await scan(mo, "chat conversation");

  // Badr opens the same channel, sees it, and replies with a mention; Mo's window shows it without a reload
  await badr.goto(general);
  await ready(badr);
  await expect(log(badr)).toContainText("Morning team");
  await badr.getByLabel("Message", { exact: true }).fill("@M");
  await badr.getByRole("option", { name: "Mo" }).click();
  await expect(badr.getByLabel("Message", { exact: true })).toHaveValue("@Mo ");
  await badr.getByLabel("Message", { exact: true }).pressSequentially("I'll post it on Instagram");
  await badr.getByLabel("Message", { exact: true }).press("Enter");
  await expect(log(mo)).toContainText("@Mo I'll post it on Instagram", { timeout: 15_000 });

  // the mention reached Mo's inbox; Mo already saw it in the open channel, so it is cleared. It opens the channel.
  await mo.goto("/inbox?tab=cleared");
  await mo.getByRole("link", { name: "Badr mentioned you in #general" }).click();
  await expect(mo).toHaveURL(general);

  // Mo fixes a typo in their message: Badr's window shows the edit
  const mine = log(mo).locator("li", { hasText: "Morning team" });
  await mine.hover();
  await mine.getByRole("button", { name: "Edit message" }).click();
  const edit = mo.getByLabel("Edit message");
  await edit.fill("Morning team, the new batch opens Saturday");
  await edit.press("Enter");
  await expect(log(badr)).toContainText("opens Saturday", { timeout: 15_000 });
  await expect(log(badr).locator("li", { hasText: "opens Saturday" })).toContainText("(edited)");

  // a direct message: only the two of them; Badr sees it as unread in the list
  await mo.goto("/chat/new");
  await scan(mo, "new conversation");
  await mo.getByLabel("Badr").check();
  await mo.getByRole("button", { name: "Open the conversation" }).click();
  await expect(mo.getByRole("heading", { name: "Chat: Badr" })).toBeAttached();
  await ready(mo);
  await send(mo, "Can you approve the March payout today?");
  await expect(log(mo)).toContainText("approve the March payout");
  await expect(badr.getByRole("navigation", { name: "Conversations" }).getByRole("link", { name: /Mo.*1 unread/ })).toBeVisible({ timeout: 15_000 });
  await badr.getByRole("navigation", { name: "Conversations" }).getByRole("link", { name: /Mo/ }).click();
  await expect(log(badr)).toContainText("approve the March payout");

  // a new channel: Mo creates it, Badr finds it under Browse and joins
  await mo.goto("/chat/new?tab=channel");
  await mo.getByLabel("Name").fill("Launch Plan");
  await mo.getByLabel("Topic (optional)").fill("Saturday's batch launch");
  await mo.getByRole("button", { name: "Create the channel" }).click();
  await expect(mo.getByRole("heading", { name: "Chat: #launch-plan" })).toBeAttached();
  await badr.goto("/chat/new?tab=browse");
  await badr.getByRole("listitem").filter({ hasText: "#launch-plan" }).getByRole("button", { name: "Join" }).click();
  await expect(badr.getByRole("heading", { name: "Chat: #launch-plan" })).toBeAttached();
  await expect(badr.getByRole("navigation", { name: "Conversations" }).getByRole("link", { name: "launch-plan" })).toBeVisible();
});
