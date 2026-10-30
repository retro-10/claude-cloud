import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { sendNotificationEmails } from "@/lib/email";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("email digests of unread notifications", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const sent: { to: string[]; subject: string; text: string; html: string; from: string }[] = [];
  let ok = true;
  const env = { ...process.env };
  let retro: number, mo: number;
  const now = new Date("2026-10-30T12:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    [{ id: retro }] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, "retro@orladent.local"));
    [{ id: mo }] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.email, "mo@orladent.local"));
    process.env.APP_URL = "https://hq.orladent.com";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit) => {
        expect(String(input)).toBe("https://api.resend.com/emails");
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer re_test");
        if (!ok) return new Response(JSON.stringify({ message: "rate limited" }), { status: 429 });
        sent.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ id: "e1" }));
      }),
    );
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    process.env = env;
    await client.end();
  });

  it("with email off nothing is sent, and the notifications are not kept waiting", async () => {
    delete process.env.RESEND_API_KEY;
    await db.insert(s.notifications).values({ userId: retro, kind: "approval_request", title: "Mona asks: Printing", link: "/approvals/1", createdAt: minutesAgo(20) });
    expect(await sendNotificationEmails(db, now)).toEqual({ emails: 0, items: 0 });
    expect(sent).toEqual([]);
    expect((await db.select().from(s.notifications)).every((n) => n.emailedAt)).toBe(true);
  });

  it("one digest per person: important kinds only by default, never what was read or is under 10 minutes old", async () => {
    process.env.RESEND_API_KEY = "re_test";
    await db.insert(s.notifications).values([
      { userId: retro, kind: "approval_request", title: "Mona asks: Ring light", link: "/approvals/2", createdAt: minutesAgo(30) },
      { userId: retro, kind: "chat_mention", title: "Badr mentioned you in #general", link: "/chat/1", createdAt: minutesAgo(15) },
      { userId: retro, kind: "owner_assigned", title: "A lead is now yours", createdAt: minutesAgo(15) }, // not important
      { userId: retro, kind: "chat_dm", title: "New message from Mo", link: "/chat/2", createdAt: minutesAgo(3) }, // too recent
      { userId: retro, kind: "chat_dm", title: "Old read one", link: "/chat/3", createdAt: minutesAgo(40), readAt: minutesAgo(35) },
    ]);
    expect(await sendNotificationEmails(db, now)).toEqual({ emails: 1, items: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["retro@orladent.local"]);
    expect(sent[0].from).toBe("OrlaDent HQ <hq@orladent.com>");
    expect(sent[0].subject).toBe("2 things waiting for you in HQ");
    expect(sent[0].text).toContain("https://hq.orladent.com/approvals/2");
    expect(sent[0].html).toContain('<a href="https://hq.orladent.com/chat/1">Badr mentioned you in #general</a>');
    expect(sent[0].text).not.toContain("A lead is now yours");
    // nothing is sent twice; the recent one goes out once it is 10 minutes old
    expect(await sendNotificationEmails(db, now)).toEqual({ emails: 0, items: 0 });
    expect(await sendNotificationEmails(db, new Date(now.getTime() + 10 * 60_000))).toEqual({ emails: 1, items: 1 });
    expect(sent[1].subject).toBe("New message from Mo");
  });

  it("'all' includes everything, 'none' nothing; titles are escaped in HTML", async () => {
    await db.update(s.users).set({ emailNotifications: "all" }).where(eq(s.users.id, mo));
    await db.update(s.users).set({ emailNotifications: "none" }).where(eq(s.users.id, retro));
    const later = new Date(now.getTime() + 60 * 60_000);
    await db.insert(s.notifications).values([
      { userId: mo, kind: "owner_assigned", title: "A <b>lead</b> is now yours", createdAt: new Date(later.getTime() - 20 * 60_000) },
      { userId: retro, kind: "approval_request", title: "Not by email", createdAt: new Date(later.getTime() - 20 * 60_000) },
    ]);
    const before = sent.length;
    expect(await sendNotificationEmails(db, later)).toEqual({ emails: 1, items: 1 });
    expect(sent[before].to).toEqual(["mo@orladent.local"]);
    expect(sent[before].html).toContain("A &lt;b&gt;lead&lt;/b&gt; is now yours");
  });

  it("a failed send is retried on the next run", async () => {
    const t = new Date(now.getTime() + 3 * 3_600_000);
    await db.insert(s.notifications).values({ userId: mo, kind: "approval_question", title: "Badr needs more on: Tripod", createdAt: new Date(t.getTime() - 20 * 60_000) });
    ok = false;
    expect(await sendNotificationEmails(db, t)).toEqual({ emails: 0, items: 0 });
    ok = true;
    expect(await sendNotificationEmails(db, new Date(t.getTime() + 5 * 60_000))).toEqual({ emails: 1, items: 1 });
  });
});
