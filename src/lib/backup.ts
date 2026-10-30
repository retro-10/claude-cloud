import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { appSettings } from "@/db/schema";
import { audit } from "./audit";
import { DriveError, driveOn, driveStatus, driveSubfolder, listDriveFiles, trashInDrive, uploadToDrive } from "./drive";
import type { Fail } from "./result";
import { TZ } from "./time";

// Nightly database backup to Google Drive, for hosts without one of their own (Supabase's free plan keeps no backups).
// The app runs pg_dump (custom format, compressed) over the HQ schemas, uploads it to a "Backups" folder inside the
// app's Drive folder and keeps the newest 14. It runs from the 5-minute tick once a day has passed since the last one,
// or from Settings > Integrations. Restore: download a file, then `pg_restore --clean --no-owner -d <DATABASE_URL> file`.

export const KEEP = 14;
const EVERY_MS = 23 * 3_600_000;
const RETRY_MS = 3_600_000; // after a failure, wait an hour before trying again
const MAX_BYTES = 500 * 1024 * 1024;
const KEY = "backupState";

export type BackupState = { lastAt: string | null; lastName: string | null; lastSize: number; lastError: string | null; lastErrorAt: string | null };
const EMPTY: BackupState = { lastAt: null, lastName: null, lastSize: 0, lastError: null, lastErrorAt: null };

export async function backupState(db: Pick<Db, "select">): Promise<BackupState> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY));
  return { ...EMPTY, ...((row?.value as Partial<BackupState>) ?? {}) };
}

async function saveState(db: Db, patch: Partial<BackupState>) {
  const value = { ...(await backupState(db)), ...patch };
  await db.insert(appSettings).values({ key: KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** pg_dump of the app's schemas. Credentials go through the environment, never the command line. */
export function pgDump(url = process.env.DATABASE_URL): Promise<Buffer> {
  if (!url) return Promise.reject(new Error("DATABASE_URL is not set"));
  const u = new URL(url);
  const hosted = /(^|\.)(supabase\.co|supabase\.com)$/.test(u.hostname);
  const env = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)) || "postgres",
    PGSSLMODE: u.searchParams.get("sslmode") ?? (hosted ? "require" : "prefer"),
    PGCONNECT_TIMEOUT: "20",
  };
  return new Promise((resolve, reject) => {
    // only the app's own schemas: a hosted database has others (auth, storage …) that are not ours to copy
    const p = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--schema=public", "--schema=drizzle"], { env });
    const out: Buffer[] = [];
    let size = 0;
    let err = "";
    p.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) p.kill();
      else out.push(c);
    });
    p.stderr.on("data", (c: Buffer) => {
      err = (err + c.toString()).slice(-2000);
    });
    p.on("error", (e) => reject(new Error(`pg_dump could not start (${e.message})`)));
    p.on("close", (code) => {
      if (size > MAX_BYTES) return reject(new Error("The backup is larger than 500 MB"));
      if (code !== 0) return reject(new Error(`pg_dump failed: ${err.trim().split("\n").pop() ?? `exit ${code}`}`));
      resolve(Buffer.concat(out));
    });
  });
}

const stamp = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d).replace(" ", "_").replace(":", "");

let running = false;

/** One backup now: dump, upload, keep the newest 14. */
export async function runBackup(db: Db, by: number | null = null, now = new Date()): Promise<{ ok: true; name: string; size: number; removed: number } | Fail> {
  if (!driveOn(await driveStatus(db))) return { ok: false, error: "Connect Google Drive first: backups are kept there" };
  if (running) return { ok: false, error: "A backup is already running" };
  running = true;
  try {
    const bytes = await pgDump();
    const parent = await driveSubfolder(db, "Backups");
    const name = `orladent-hq-${stamp(now)}.dump`;
    await uploadToDrive(db, { name, contentType: "application/octet-stream", bytes, kind: "backup", parent, description: "OrlaDent HQ database backup (pg_dump custom format)" });
    const old = (await listDriveFiles(db, parent, "backup")).slice(KEEP);
    for (const f of old) await trashInDrive(db, f.id);
    await saveState(db, { lastAt: now.toISOString(), lastName: name, lastSize: bytes.length, lastError: null, lastErrorAt: null });
    await audit(db, { userId: by, entity: "backup", action: "create", diff: { name, size: bytes.length, removed: old.length } });
    return { ok: true, name, size: bytes.length, removed: old.length };
  } catch (e) {
    const error = e instanceof DriveError || e instanceof Error ? e.message : "The backup failed";
    await saveState(db, { lastError: error, lastErrorAt: now.toISOString() });
    await audit(db, { userId: by, entity: "backup", action: "failed", diff: { error } });
    return { ok: false, error };
  } finally {
    running = false;
  }
}

/** From the 5-minute tick: a backup once a day, while Drive is connected; after a failure, retry hourly. */
export async function backupIfDue(db: Db, now = new Date()) {
  if (!driveOn(await driveStatus(db))) return null;
  const st = await backupState(db);
  if (st.lastAt && now.getTime() - Date.parse(st.lastAt) < EVERY_MS) return null;
  if (st.lastErrorAt && now.getTime() - Date.parse(st.lastErrorAt) < RETRY_MS) return null;
  return runBackup(db, null, now);
}
