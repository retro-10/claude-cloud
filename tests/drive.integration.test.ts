import { createVerify, generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionOptions } from "@/db/connection";
import { runMigrations } from "@/db/migrate";
import { seedReference } from "@/db/seed";
import * as s from "@/db/schema";
import type { Db } from "@/db";
import { addAttachment, deleteAttachment, fileStoreCounts, getAttachment, listAttachments, moveFilesToDrive } from "@/lib/attachments";
import { connectDrive, disconnectDrive, driveAuthUrl, driveStatus, resetDriveCache } from "@/lib/drive";
import { createLead } from "@/lib/leads";

describe("database connection options", () => {
  it("Supabase gets TLS, its transaction pooler gets no prepared statements, a local database neither", () => {
    expect(connectionOptions("postgres://crm:pw@db:5432/crm", 10)).toEqual({ max: 10, onnotice: expect.any(Function) });
    const session = connectionOptions("postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres", 5);
    expect(session).toMatchObject({ max: 5, ssl: "require" });
    expect(session).not.toHaveProperty("prepare");
    expect(connectionOptions("postgresql://postgres.abc:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres")).toMatchObject({ ssl: "require", prepare: false });
    expect(connectionOptions("postgresql://postgres:pw@db.abc.supabase.co:5432/postgres")).toMatchObject({ ssl: "require" });
    // an explicit sslmode in the URL is left to postgres.js
    expect(connectionOptions("postgresql://postgres:pw@db.abc.supabase.co:5432/postgres?sslmode=verify-full")).not.toHaveProperty("ssl");
    expect(connectionOptions("postgres://x@notsupabase.com.evil:5432/x")).not.toHaveProperty("ssl");
    // on Vercel, idle connections close so a frozen copy of the app does not hold them
    const before = process.env.VERCEL;
    process.env.VERCEL = "1";
    expect(connectionOptions("postgres://crm:pw@db:5432/crm", 5)).toMatchObject({ idle_timeout: 20 });
    if (before === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = before;
  });
});

// A Google Drive that lives in memory: the token endpoint, folder creation, multipart upload, download and trash.
function fakeDrive() {
  const files = new Map<string, { name: string; parents: string[]; bytes: Buffer; trashed: boolean; mimeType?: string }>();
  const state = { up: true, revoked: false, tokens: 0, n: 0 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const handler = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (!state.up) return json({ error: { message: "Backend Error", errors: [{ reason: "backendError" }] } }, 503);
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
      const body = new URLSearchParams(String(init.body));
      if (body.get("grant_type") === "authorization_code") return body.get("code") === "good" ? json({ access_token: "at", expires_in: 3600, refresh_token: "rt-1" }) : json({ error: "invalid_grant" }, 400);
      if (state.revoked || body.get("refresh_token") !== "rt-1") return json({ error: "invalid_grant" }, 400);
      state.tokens++;
      return json({ access_token: "at", expires_in: 3600 });
    }
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/revoke") return json({});
    if (url.host === "openidconnect.googleapis.com") return json({ email: "camp@example.com" });
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer at");
    if (url.pathname === "/upload/drive/v3/files") {
      const raw = Buffer.from(init.body as Buffer);
      const boundary = /boundary=(.+)$/.exec(new Headers(init.headers).get("Content-Type")!)![1];
      const parts = raw.toString("latin1").split(`--${boundary}`);
      const meta = JSON.parse(parts[1].split("\r\n\r\n")[1]);
      const body = parts[2].slice(parts[2].indexOf("\r\n\r\n") + 4, -2);
      const id = `f${++state.n}`;
      files.set(id, { name: meta.name, parents: meta.parents, bytes: Buffer.from(body, "latin1"), trashed: false });
      return json({ id });
    }
    if (url.pathname === "/drive/v3/files" && init.method === "POST") {
      const meta = JSON.parse(String(init.body));
      const id = `folder${++state.n}`;
      files.set(id, { name: meta.name, parents: [], bytes: Buffer.alloc(0), trashed: false, mimeType: meta.mimeType });
      return json({ id });
    }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    const f = m && files.get(decodeURIComponent(m[1]));
    if (!f) return json({ error: { message: "File not found" } }, 404);
    if (init.method === "PATCH") {
      f.trashed = JSON.parse(String(init.body)).trashed;
      return json({ id: m![1] });
    }
    return new Response(new Uint8Array(f.bytes));
  };
  return { files, state, handler };
}

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("files in Google Drive", () => {
  const client = postgres(url ?? "postgres://x", { max: 4, onnotice: () => {} });
  const db = drizzle(client, { schema: s }) as unknown as Db;
  const drive = fakeDrive();
  let owner: number, leadId: number;
  const env = { ...process.env };

  beforeAll(async () => {
    await client.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await runMigrations(url);
    await seedReference(url, "pw");
    owner = (await db.select().from(s.users).where(eq(s.users.email, "retro@orladent.local")))[0].id;
    const l = await createLead(db, { fullName: "Drive Lead", phone: "01044440000" }, owner);
    if (!l.ok) throw new Error("setup");
    leadId = l.lead.id;
    vi.stubGlobal("fetch", vi.fn(drive.handler));
  });
  beforeEach(() => {
    process.env.AUTH_SECRET = "x".repeat(40);
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_DRIVE_FOLDER_ID;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    process.env = env;
    await client.end();
  });

  it("every public table has row level security, so Supabase's Data API cannot read it", async () => {
    const open = await client`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(open.map((r) => r.relname)).toEqual([]);
    // the app connects as the owner, so it still reads everything
    expect((await db.select().from(s.users)).length).toBeGreaterThan(0);
  });

  it("without Google settings files stay in the database", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(await driveStatus(db)).toEqual({ mode: "off" });
    expect(driveAuthUrl("https://x/cb", "st")).toBeNull();
    expect(await addAttachment(db, { name: "before.pdf", bytes: Buffer.from("%PDF old") }, { leadId }, owner)).toMatchObject({ ok: true });
    expect(await moveFilesToDrive(db)).toEqual({ moved: 0, failed: 0 });
    expect(drive.files.size).toBe(0);
  });

  it("an owner connects a Google account; the refresh token is stored encrypted", async () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "csecret";
    expect(await driveStatus(db)).toEqual({ mode: "ready-to-connect" });
    const auth = new URL(driveAuthUrl("https://hq.example.com/settings/integrations/drive/callback", "st")!);
    expect(auth.searchParams.get("scope")).toContain("auth/drive.file");
    expect(auth.searchParams.get("access_type")).toBe("offline");
    expect(auth.searchParams.get("state")).toBe("st");
    expect(await connectDrive(db, "bad", "https://x/cb", owner)).toMatchObject({ ok: false });
    expect(await connectDrive(db, "good", "https://x/cb", owner)).toEqual({ ok: true, email: "camp@example.com" });
    const [row] = await db.select().from(s.appSettings).where(eq(s.appSettings.key, "googleDrive"));
    expect(JSON.stringify(row.value)).not.toContain("rt-1");
    expect(await driveStatus(db)).toEqual({ mode: "oauth", email: "camp@example.com", folderId: null });
  });

  it("new files go to Drive, in one folder the app creates; downloads and deletes go through Drive", async () => {
    const pdf = Buffer.from("%PDF-1.4 certificate é");
    const r = await addAttachment(db, { name: "certificate.pdf", bytes: pdf }, { leadId }, owner);
    if (!r.ok) throw new Error(r.error);
    const [row] = await db.select().from(s.attachments).where(eq(s.attachments.id, r.id));
    expect(row).toMatchObject({ data: null, size: pdf.length });
    const inDrive = drive.files.get(row.driveFileId!)!;
    expect(inDrive.bytes.equals(pdf)).toBe(true);
    const folders = [...drive.files.values()].filter((f) => f.mimeType === "application/vnd.google-apps.folder");
    expect(folders.map((f) => f.name)).toEqual(["OrlaDent OS files"]);
    expect(inDrive.parents).toEqual([[...drive.files.entries()].find(([, f]) => f.mimeType)![0]]);
    expect((await getAttachment(db, r.id))!.data.equals(pdf)).toBe(true);

    await addAttachment(db, { name: "second.png", bytes: Buffer.from("png") }, { leadId }, owner);
    expect([...drive.files.values()].filter((f) => f.mimeType).length).toBe(1); // the folder is reused
    expect(drive.state.tokens).toBe(1); // and the access token

    expect(await deleteAttachment(db, r.id, { id: owner, isOwner: true })).toEqual({ ok: true });
    expect(inDrive.trashed).toBe(true);
    expect(await getAttachment(db, r.id)).toBeNull();
  });

  it("when Drive is down an upload is kept in the database, then moved across once Drive is back", async () => {
    drive.state.up = false;
    const r = await addAttachment(db, { name: "offline.pdf", bytes: Buffer.from("%PDF offline") }, { leadId }, owner);
    if (!r.ok) throw new Error(r.error);
    expect((await db.select().from(s.attachments).where(eq(s.attachments.id, r.id)))[0]).toMatchObject({ driveFileId: null });
    expect(await moveFilesToDrive(db)).toMatchObject({ moved: 0, failed: 1 });
    drive.state.up = true;
    expect(await fileStoreCounts(db)).toMatchObject({ inDrive: 1, inDatabase: 2 }); // before.pdf and offline.pdf
    expect(await moveFilesToDrive(db)).toEqual({ moved: 2, failed: 0, error: undefined });
    expect(await fileStoreCounts(db)).toEqual({ inDrive: 3, inDatabase: 0, databaseBytes: 0 });
    const files = await listAttachments(db, { leadId });
    for (const f of files) expect((await getAttachment(db, f.id))!.data.length).toBe(f.size);
  });

  it("a Workspace service account signs its own token and uses the shared-drive folder it is given", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const sa = { client_email: "files@camp.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify(sa)).toString("base64");
    process.env.GOOGLE_DRIVE_FOLDER_ID = "shared-folder";
    expect(await driveStatus(db)).toEqual({ mode: "service", email: sa.client_email, folderId: "shared-folder" });
    resetDriveCache();
    const real = drive.handler;
    let claims: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit = {}) => {
        if (String(input).endsWith("/token")) {
          const body = new URLSearchParams(String(init.body));
          expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
          const [h, p, sig] = body.get("assertion")!.split(".");
          expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, sig, "base64url")).toBe(true);
          claims = JSON.parse(Buffer.from(p, "base64url").toString());
          return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
        }
        return real(input, init);
      }),
    );
    const r = await addAttachment(db, { name: "sa.pdf", bytes: Buffer.from("%PDF sa") }, { leadId }, owner);
    vi.stubGlobal("fetch", vi.fn(real));
    if (!r.ok) throw new Error(r.error);
    expect(claims).toMatchObject({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive", aud: "https://oauth2.googleapis.com/token" });
    const [row] = await db.select().from(s.attachments).where(eq(s.attachments.id, r.id));
    expect(drive.files.get(row.driveFileId!)!.parents).toEqual(["shared-folder"]);
    resetDriveCache();
  });

  it("a revoked account says so; disconnecting falls back to the database", async () => {
    drive.state.revoked = true;
    resetDriveCache();
    const [f] = await listAttachments(db, { leadId });
    await expect(getAttachment(db, f.id)).rejects.toThrow(/reconnect/);
    await disconnectDrive(db, owner);
    expect(await driveStatus(db)).toEqual({ mode: "ready-to-connect" });
    const r = await addAttachment(db, { name: "after.pdf", bytes: Buffer.from("%PDF after") }, { leadId }, owner);
    if (!r.ok) throw new Error(r.error);
    expect((await getAttachment(db, r.id))!.data.toString()).toBe("%PDF after");
  });
});
