import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { contentFromProof, getContent, listContent, saveContent, setContentStatus } from "@/lib/content";
import { createLead } from "@/lib/leads";
import { withoutRelease11Rules } from "./base-rules";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("content calendar", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  let userId: number, reelId: number;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await withoutRelease11Rules(client);
    userId = (await db.select().from(s.users))[0].id;
  });
  afterAll(() => client.end());

  it("plans a piece with a tag for its links; posted gets a date; bad input is refused", async () => {
    const r = await saveContent(db, null, { title: "Crown design in 60 seconds", platform: "instagram", format: "reel", status: "idea", publishAt: new Date("2026-10-12T16:00:00Z") }, userId);
    if (!r.ok) throw new Error(r.error);
    reelId = r.id;
    expect((await getContent(db, reelId))!.tag).toBe(`c${reelId}-crown-design-in-60-seconds`);
    expect(await saveContent(db, null, { title: " ", platform: "instagram", format: "reel", status: "idea" }, userId)).toMatchObject({ ok: false });
    expect(await saveContent(db, reelId, { title: "x", platform: "instagram", format: "reel", status: "idea", postUrl: "javascript:alert(1)" }, userId)).toEqual({ ok: false, error: "The post link must start with https://" });
    expect(await setContentStatus(db, reelId, "posted", userId)).toBe(true);
    const posted = (await getContent(db, reelId))!.postedAt;
    expect(posted).not.toBeNull();
    await setContentStatus(db, reelId, "posted", userId);
    expect((await getContent(db, reelId))!.postedAt).toEqual(posted); // keeps the first posted time
  });

  it("the month view holds dated pieces in range plus undated ideas, and counts leads by the piece's tag", async () => {
    await saveContent(db, null, { title: "Undated idea", platform: "tiktok", format: "video", status: "idea" }, userId);
    await saveContent(db, null, { title: "November post", platform: "facebook", format: "post", status: "idea", publishAt: new Date("2026-11-03T10:00:00Z") }, userId);
    const tag = (await getContent(db, reelId))!.tag!;
    const l = await createLead(db, { fullName: "From the reel", phone: "01066600001", attribution: { utm_content: tag } }, userId);
    if (!l.ok) throw new Error("setup");
    const oct = await listContent(db, { from: new Date("2026-09-30T21:00:00Z"), to: new Date("2026-10-31T22:00:00Z") });
    expect(oct.map((c) => c.title)).toEqual(["Crown design in 60 seconds", "Undated idea"]);
    expect(oct[0].leads).toBe(1);
  });

  it("proof-to-post only for proof cleared to use, once per proof item", async () => {
    const [asked] = await db.insert(s.proofItems).values({ name: "QC 95", consentStatus: "Asked", usableIn: ["Carousel"] }).returning();
    const [granted] = await db.insert(s.proofItems).values({ name: "Voice note", consentStatus: "Granted", usableIn: ["Carousel"], quote: "I designed my first crown in week two" }).returning();
    expect(await contentFromProof(db, asked.id, userId)).toEqual({ ok: false, error: "Not ready to use: consent is not granted" });
    const r = await contentFromProof(db, granted.id, userId);
    if (!r.ok) throw new Error(r.error);
    const c = (await getContent(db, r.id))!;
    expect(c).toMatchObject({ title: "Proof: Voice note", format: "carousel", status: "idea", proofItemId: granted.id });
    expect(c.brief).toContain('"I designed my first crown in week two"');
    expect(c.brief).toContain("No income promises.");
    expect(await contentFromProof(db, granted.id, userId)).toEqual({ ok: true, id: r.id });
    expect(await db.select().from(s.contentItems).where(eq(s.contentItems.proofItemId, granted.id))).toHaveLength(1);
  });
});
