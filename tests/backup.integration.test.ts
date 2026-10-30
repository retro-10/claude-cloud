import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { KEEP, backupIfDue, backupState, pgDump, runBackup } from "@/lib/backup";
import { connectDrive, resetDriveCache, uploadToDrive } from "@/lib/drive";

const hasPgDump = (() => {
  try {
    execFileSync("pg_dump", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

// A Drive in memory: token, folders, simple and resumable uploads, listing by app property, trash.
function fakeDrive() {
  const files = new Map<string, { name: string; parents: string[]; bytes: Buffer; kind?: string; trashed: boolean; created: number; folder?: boolean }>();
  const sessions = new Map<string, { meta: { name: string; parents: string[]; appProperties?: { orladent?: string } } }>();
  const st = { n: 0, resumable: 0 };
  const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...headers } });
  const handler = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") return json({ access_token: "at", expires_in: 3600, refresh_token: "rt" });
    if (url.host === "openidconnect.googleapis.com") return json({ email: "camp@example.com" });
    if (url.pathname === "/upload/drive/v3/files" && url.searchParams.get("uploadType") === "resumable") {
      const id = `s${++st.n}`;
      sessions.set(id, { meta: JSON.parse(String(init.body)) });
      return json({}, 200, { location: `https://www.googleapis.com/upload/session/${id}` });
    }
    if (url.pathname.startsWith("/upload/session/")) {
      const sess = sessions.get(url.pathname.split("/").pop()!)!;
      const id = `f${++st.n}`;
      st.resumable++;
      files.set(id, { name: sess.meta.name, parents: sess.meta.parents, bytes: Buffer.from(init.body as Uint8Array), kind: sess.meta.appProperties?.orladent, trashed: false, created: st.n });
      return json({ id });
    }
    if (url.pathname === "/upload/drive/v3/files") {
      const raw = Buffer.from(init.body as Buffer).toString("latin1");
      const boundary = /boundary=(.+)$/.exec(new Headers(init.headers).get("Content-Type")!)![1];
      const parts = raw.split(`--${boundary}`);
      const meta = JSON.parse(parts[1].split("\r\n\r\n")[1]);
      const body = parts[2].slice(parts[2].indexOf("\r\n\r\n") + 4, -2);
      const id = `f${++st.n}`;
      files.set(id, { name: meta.name, parents: meta.parents, bytes: Buffer.from(body, "latin1"), kind: meta.appProperties?.orladent, trashed: false, created: st.n });
      return json({ id });
    }
    if (url.pathname === "/drive/v3/files" && init.method === "POST") {
      const meta = JSON.parse(String(init.body));
      const id = `d${++st.n}`;
      files.set(id, { name: meta.name, parents: meta.parents ?? [], bytes: Buffer.alloc(0), trashed: false, created: st.n, folder: true });
      return json({ id });
    }
    if (url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q")!;
      const parent = /'([^']+)' in parents/.exec(q)![1];
      const kind = /value='([^']+)'/.exec(q)![1];
      const list = [...files.entries()]
        .filter(([, f]) => f.parents.includes(parent) && !f.trashed && f.kind === kind)
        .sort((a, b) => b[1].created - a[1].created)
        .map(([id, f]) => ({ id, name: f.name, size: String(f.bytes.length), createdTime: new Date(f.created * 1000).toISOString() }));
      return json({ files: list });
    }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (m && init.method === "PATCH") {
      files.get(m[1])!.trashed = true;
      return json({ id: m[1] });
    }
    return json({ error: { message: "not found" } }, 404);
  };
  return { files, st, handler };
}

const url = process.env.TEST_DATABASE_URL;
const d = url && hasPgDump ? describe : describe.skip;

d("nightly database backup to Drive", () => {
  const client = postgres(url ?? "postgres://x", { max: 2, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const drive = fakeDrive();
  const env = { ...process.env };

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    process.env.DATABASE_URL = url;
    process.env.AUTH_SECRET = "x".repeat(40);
    vi.stubGlobal("fetch", vi.fn(drive.handler));
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    process.env = env;
    resetDriveCache();
    await client.end();
  });

  it("pg_dump produces a custom-format archive that restores into an empty database", async () => {
    const bytes = await pgDump(url);
    expect(bytes.subarray(0, 5).toString()).toBe("PGDMP");
    const scratch = "crm_restore_check";
    await client.unsafe(`drop database if exists ${scratch}`);
    await client.unsafe(`create database ${scratch}`);
    const target = new URL(url!);
    target.pathname = `/${scratch}`;
    // the same command the README gives for a restore
    execFileSync("pg_restore", ["--clean", "--if-exists", "--no-owner", "--dbname", target.toString()], { input: bytes, stdio: ["pipe", "pipe", "pipe"] });
    const other = postgres(target.toString(), { max: 1, onnotice: () => {} });
    try {
      const [{ n }] = await other`select count(*)::int as n from users`;
      const [{ m }] = await client`select count(*)::int as m from users`;
      expect(n).toBe(m);
      const [{ applied }] = await other`select count(*)::int as applied from drizzle.__drizzle_migrations`;
      expect(applied).toBeGreaterThan(30);
    } finally {
      await other.end();
      await client.unsafe(`drop database if exists ${scratch}`);
    }
  });

  it("does nothing until Drive is connected", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect(await backupIfDue(db)).toBeNull();
    expect(await runBackup(db)).toMatchObject({ ok: false, error: expect.stringContaining("Connect Google Drive") });
  });

  it("uploads to a Backups folder, records the result, and runs again only after a day", async () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "cs";
    const [owner] = await db.select().from(s.users).limit(1);
    expect(await connectDrive(db, "code", "https://x/cb", owner.id)).toMatchObject({ ok: true });
    const t0 = new Date("2026-10-30T01:00:00Z");
    const r = await backupIfDue(db, t0);
    expect(r).toMatchObject({ ok: true, name: "orladent-hq-2026-10-30_0300.dump", removed: 0 });
    const folder = [...drive.files.entries()].find(([, f]) => f.folder && f.name === "Backups")!;
    const saved = [...drive.files.values()].filter((f) => f.kind === "backup");
    expect(saved).toHaveLength(1);
    expect(saved[0].parents).toEqual([folder[0]]);
    expect(saved[0].bytes.subarray(0, 5).toString()).toBe("PGDMP");
    expect(await backupState(db)).toMatchObject({ lastAt: t0.toISOString(), lastError: null });
    expect(await backupIfDue(db, new Date(t0.getTime() + 3_600_000))).toBeNull();
    expect(await backupIfDue(db, new Date(t0.getTime() + 24 * 3_600_000))).toMatchObject({ ok: true });
  });

  it(`keeps the newest ${KEEP}`, async () => {
    for (let i = 0; i < KEEP + 2; i++) await runBackup(db, null, new Date(Date.UTC(2026, 10, 1 + i)));
    const live = [...drive.files.values()].filter((f) => f.kind === "backup" && !f.trashed);
    expect(live).toHaveLength(KEEP);
    expect(live.map((f) => f.name).sort().at(-1)).toBe("orladent-hq-2026-11-16_0200.dump");
  });

  it("files over 4 MB go through a resumable upload", async () => {
    const before = drive.st.resumable;
    await uploadToDrive(db, { name: "big.stl", contentType: "model/stl", bytes: Buffer.alloc(5 * 1024 * 1024, 1) });
    expect(drive.st.resumable).toBe(before + 1);
    expect([...drive.files.values()].find((f) => f.name === "big.stl")!.bytes.length).toBe(5 * 1024 * 1024);
  });

  it("a failure is recorded and retried after an hour, not every 5 minutes", async () => {
    process.env.DATABASE_URL = "postgres://nobody:wrong@127.0.0.1:1/none";
    const t = new Date("2026-12-01T00:00:00Z");
    expect(await backupIfDue(db, t)).toMatchObject({ ok: false, error: expect.stringContaining("pg_dump") });
    expect((await backupState(db)).lastError).toContain("pg_dump");
    expect(await backupIfDue(db, new Date(t.getTime() + 10 * 60_000))).toBeNull();
    process.env.DATABASE_URL = url;
    expect(await backupIfDue(db, new Date(t.getTime() + 2 * 3_600_000))).toMatchObject({ ok: true });
  });
});
