import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { acknowledge, feed, openAnnouncement, publish, remindUnacknowledged, setArchived, tracking, unreadCounts } from "@/lib/announcements";
import { createAsset, getAsset, listAssets, newVersion, recordAssetDownload, setRetired, allTags } from "@/lib/brand";
import { saveDoc } from "@/lib/hq";
import { createUser } from "@/lib/settings";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("announcements and the brand hub", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  type P = { id: number; name: string };
  let retro: P, mona: P, omar: P, nour: P;

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    await db.update(s.users).set({ active: false });
    const [r] = await db.update(s.users).set({ active: true }).where(eq(s.users.email, "retro@orladent.local")).returning();
    retro = { id: r.id, name: r.name };
    const mk = async (name: string, role: "sales" | "designer" | "marketing") => {
      const u = await createUser(db, { name, email: `${name.toLowerCase()}@cb.local`, role, password: "long enough pw" }, null);
      if (!u.ok) throw new Error("user");
      return { id: u.id, name };
    };
    mona = await mk("Mona", "sales");
    omar = await mk("Omar", "designer");
    nour = await mk("Nour", "marketing");
  });
  afterAll(() => client.end());

  it("an announcement goes to its audience only; the author has read it; everyone else is notified", async () => {
    expect(await publish(db, retro, { title: " " })).toMatchObject({ ok: false });
    const r = await publish(db, retro, { title: "New pricing from November", body: "**Read** the new price sheet.", audience: ["sales", "marketing"] });
    if (!r.ok) throw new Error(r.error);
    expect(r.people).toBe(2);
    expect((await feed(db, mona.id)).map((a) => a.title)).toEqual(["New pricing from November"]);
    expect(await feed(db, omar.id)).toEqual([]);
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.kind, "announcement"));
    expect(notes.map((n) => n.userId).sort()).toEqual([mona.id, nour.id].sort());
    // everyone: the author's receipt is read already
    const all = await publish(db, retro, { title: "Office closed Friday" });
    if (!all.ok) throw new Error(all.error);
    expect(all.people).toBe(4);
    expect((await tracking(db, all.id)).find((t) => t.id === retro.id)?.readAt).not.toBeNull();
  });

  it("opening marks it read and clears its notification; only receivers (and owners) can open it", async () => {
    const a = (await feed(db, mona.id)).find((x) => x.title === "New pricing from November")!; // sales and marketing only
    expect(await unreadCounts(db, mona.id)).toEqual({ unread: 2, toAck: 0 });
    expect(await openAnnouncement(db, omar.id, a.id, { canSeeAll: false })).toBeNull();
    expect(await openAnnouncement(db, mona.id, a.id, { canSeeAll: false })).toMatchObject({ title: a.title });
    expect((await unreadCounts(db, mona.id)).unread).toBe(1);
    const [n] = await db.select().from(s.notifications).where(and(eq(s.notifications.userId, mona.id), eq(s.notifications.link, `/announcements/${a.id}`)));
    expect(n.readAt).not.toBeNull();
  });

  it("must-read: acknowledged once, tracked, reminded daily for those who have not, for two weeks", async () => {
    const t0 = new Date();
    const r = await publish(db, retro, { title: "Updated refund policy", mustAck: true, pinned: true });
    if (!r.ok) throw new Error(r.error);
    expect((await feed(db, mona.id))[0]).toMatchObject({ title: "Updated refund policy", pinned: true }); // pinned first
    expect(await acknowledge(db, mona.id, r.id)).toEqual({ ok: true });
    expect(await acknowledge(db, mona.id, r.id)).toMatchObject({ ok: false });
    const plain = (await feed(db, mona.id)).find((a) => a.title === "Office closed Friday")!;
    expect(await acknowledge(db, mona.id, plain.id)).toMatchObject({ ok: false, error: expect.stringContaining("does not need") });
    const who = await tracking(db, r.id);
    expect(who.find((w) => w.id === mona.id)).toMatchObject({ acknowledgedAt: expect.any(Date), readAt: expect.any(Date) });

    expect(await remindUnacknowledged(db, new Date(t0.getTime() + 3_600_000))).toBe(0); // not before a day
    const day1 = new Date(t0.getTime() + 25 * 3_600_000);
    expect(await remindUnacknowledged(db, day1)).toBe(2); // Omar and Nour; Mona acknowledged, Retro wrote it
    expect(await remindUnacknowledged(db, new Date(day1.getTime() + 3_600_000))).toBe(0); // once a day
    expect(await remindUnacknowledged(db, new Date(day1.getTime() + 25 * 3_600_000))).toBe(2);
    expect(await remindUnacknowledged(db, new Date(t0.getTime() + 15 * 86_400_000))).toBe(0); // two weeks on: stop
    await setArchived(db, retro.id, r.id, true);
    expect((await feed(db, omar.id)).map((a) => a.title)).not.toContain("Updated refund policy");
  });

  it("brand assets: a file or a link; validated; listed by kind, tag and text; downloads counted", async () => {
    expect(await createAsset(db, nour.id, { name: "Logo", type: "logo" }, null)).toMatchObject({ ok: false, error: expect.stringContaining("file") });
    expect(await createAsset(db, nour.id, { name: "Logo", type: "spaceship", url: "https://x.y" }, null)).toMatchObject({ ok: false });
    expect(await createAsset(db, nour.id, { name: "Promo", type: "video", url: "http://insecure" }, null)).toMatchObject({ ok: false });
    // the link-only asset first, so asset ids and file ids differ (a file must be found by its asset, not by its id)
    const reel = await createAsset(db, nour.id, { name: "Launch reel", type: "video", url: "https://drive.google.com/file/d/abc" }, null);
    const logo = await createAsset(db, nour.id, { name: "Main logo", type: "logo", tags: "Camp, core, camp", version: "2025", usageNotes: "Clear space: the height of the O." }, { name: "logo.png", bytes: Buffer.from("png") });
    if (!logo.ok || !reel.ok) throw new Error("assets");
    expect(await createAsset(db, nour.id, { name: "Bad", type: "logo" }, { name: "run.exe", bytes: Buffer.from("x") })).toMatchObject({ ok: false });
    expect((await listAssets(db, { type: "logo" })).map((a) => [a.name, a.tags, !!a.fileId])).toEqual([["Main logo", ["camp", "core"], true]]);
    expect((await listAssets(db, { tag: "core" })).map((a) => a.name)).toEqual(["Main logo"]);
    expect((await listAssets(db, { q: "clear space" })).map((a) => a.name)).toEqual(["Main logo"]);
    expect(await allTags(db)).toEqual(["camp", "core"]);
    await recordAssetDownload(db, logo.id, mona.id);
    expect((await getAsset(db, logo.id))!.downloads).toBe(1);
  });

  it("a new version retires the old one everywhere; the history links both ways", async () => {
    const [logo] = await listAssets(db, { type: "logo" });
    const v2 = await newVersion(db, nour.id, logo.id, { version: "2026" }, { name: "logo-2026.png", bytes: Buffer.from("png2") });
    if (!v2.ok) throw new Error(v2.error);
    expect((await listAssets(db, { type: "logo" })).map((a) => [a.id, a.version, a.tags])).toEqual([[v2.id, "2026", ["camp", "core"]]]);
    expect((await listAssets(db, { type: "logo", retired: true })).map((a) => a.id)).toEqual([logo.id]);
    const old = await getAsset(db, logo.id);
    expect(old).toMatchObject({ status: "retired", current: { id: v2.id } });
    expect((await getAsset(db, v2.id))!.versions.map((v) => v.version)).toEqual(["2026", "2025"]);
    expect(await newVersion(db, nour.id, logo.id, { version: "x" }, null)).toMatchObject({ ok: false, error: expect.stringContaining("current version") });
    expect(await setRetired(db, nour.id, v2.id, true)).toEqual({ ok: true });
    expect(await listAssets(db, { type: "logo" })).toEqual([]);
  });

  it("brand guideline pages are docs marked brand; marking is kept when a later save does not say", async () => {
    const r = await saveDoc(db, null, { title: "Colours", body: "Indigo #4F46E5", brand: true }, nour.id);
    if (!r.ok) throw new Error(r.error);
    await saveDoc(db, r.id, { title: "Colours and type", body: "Indigo" }, mona.id); // a sales edit: brand untouched
    const [doc] = await db.select().from(s.docs).where(eq(s.docs.id, r.id));
    expect(doc).toMatchObject({ title: "Colours and type", brand: true });
  });
});
