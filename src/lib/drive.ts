import { createSign } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { appSettings } from "@/db/schema";
import { audit } from "./audit";
import { openSecret, sealSecret } from "./totp";

// Google Drive as the file store, over its REST API (no SDK). Two ways to sign in:
// - an owner connects a Google account in Settings > Integrations (OAuth, works with a personal Gmail). Needs
//   GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET; the refresh token is kept in app_settings, encrypted with AUTH_SECRET.
//   The scope is drive.file: the app sees only the files and the folder it created, nothing else in that Drive.
// - a service account (Google Workspace): GOOGLE_SERVICE_ACCOUNT_JSON plus GOOGLE_DRIVE_FOLDER_ID, a folder in a
//   shared drive the account is a member of (service accounts have no storage of their own).
// Files are never shared publicly: people download them through the app, which checks permissions and audits.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SERVICE_SCOPE = "https://www.googleapis.com/auth/drive";
const FOLDER_NAME = "OrlaDent OS files";
const SETTING = "googleDrive";
const SEAL = "google-drive";

type Stored = { refreshToken: string; email: string | null; folderId: string | null; connectedAt: string };
type ServiceAccount = { client_email: string; private_key: string };

export class DriveError extends Error {}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    // accepted as the JSON itself or base64 of it (easier to paste into a hosting panel)
    const j = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
    return j.client_email && j.private_key ? { client_email: j.client_email, private_key: j.private_key } : null;
  } catch {
    return null;
  }
}

const oauthClient = () => {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
};

async function stored(db: Pick<Db, "select">): Promise<Stored | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SETTING));
  return (row?.value as Stored | undefined) ?? null;
}

async function store(db: Db, value: Stored, userId: number | null) {
  await db
    .insert(appSettings)
    .values({ key: SETTING, value, updatedBy: userId })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}

export type DriveStatus =
  | { mode: "off" } // nothing configured: files stay in the database
  | { mode: "ready-to-connect" } // OAuth client set, no account connected yet
  | { mode: "oauth"; email: string | null; folderId: string | null }
  | { mode: "service"; email: string; folderId: string | null };

export async function driveStatus(db: Pick<Db, "select">): Promise<DriveStatus> {
  const sa = serviceAccount();
  if (sa) return { mode: "service", email: sa.client_email, folderId: process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || null };
  if (!oauthClient()) return { mode: "off" };
  const s = await stored(db);
  return s ? { mode: "oauth", email: s.email, folderId: process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || s.folderId } : { mode: "ready-to-connect" };
}

export const driveOn = (st: DriveStatus) => st.mode === "oauth" || st.mode === "service";

// ---------------- access tokens (cached for their lifetime, less a minute) ----------------

let cached: { token: string; until: number; who: string } | null = null;

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const res = await fetch(TOKEN_URL, { method: "POST", body: new URLSearchParams(body), signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof j.access_token !== "string") {
    throw new DriveError(j.error === "invalid_grant" ? "Google Drive access was revoked or expired; reconnect it in Settings > Integrations" : `Google sign-in failed (${String(j.error ?? res.status)})`);
  }
  return j as { access_token: string; expires_in: number; refresh_token?: string };
}

function serviceJwt(sa: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: SERVICE_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url")}`;
}

async function accessToken(db: Pick<Db, "select">): Promise<string> {
  const sa = serviceAccount();
  const s = sa ? null : await stored(db);
  const who = sa ? sa.client_email : (s?.refreshToken ?? "");
  if (cached && cached.who === who && cached.until > Date.now()) return cached.token;
  let r;
  if (sa) r = await tokenRequest({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceJwt(sa) });
  else {
    const client = oauthClient();
    const refresh = s && openSecret(s.refreshToken, SEAL);
    if (!client || !refresh) throw new DriveError("Google Drive is not connected");
    r = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh, client_id: client.id, client_secret: client.secret });
  }
  cached = { token: r.access_token, until: Date.now() + (r.expires_in - 60) * 1000, who };
  return r.access_token;
}

async function call(db: Pick<Db, "select">, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await accessToken(db)}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = j.error?.errors?.[0]?.reason;
    if (reason === "storageQuotaExceeded") throw new DriveError("Google Drive is full (or the service account has no storage: use a folder in a shared drive)");
    throw new DriveError(`Google Drive: ${j.error?.message ?? res.statusText ?? res.status}`);
  }
  return res;
}

// ---------------- the folder files go in ----------------

async function folder(db: Db): Promise<string> {
  const env = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (env) return env;
  const s = await stored(db);
  if (!s) throw new DriveError("Google Drive is not connected");
  if (s.folderId) return s.folderId;
  const res = await call(db, `${API}/files?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const { id } = (await res.json()) as { id: string };
  await store(db, { ...s, folderId: id }, null);
  return id;
}

// ---------------- files ----------------

export async function uploadToDrive(db: Db, file: { name: string; contentType: string; bytes: Buffer; description?: string }): Promise<string> {
  const parent = await folder(db);
  const boundary = `orladent${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const meta = { name: file.name, parents: [parent], description: file.description, appProperties: { orladent: "attachment" } };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${file.contentType}\r\n\r\n`),
    file.bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await call(db, UPLOAD, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
  return ((await res.json()) as { id: string }).id;
}

export async function downloadFromDrive(db: Pick<Db, "select">, id: string): Promise<Buffer> {
  const res = await call(db, `${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
  return Buffer.from(await res.arrayBuffer());
}

/** To Drive's bin rather than gone: an owner can still restore it there for 30 days. */
export async function trashInDrive(db: Pick<Db, "select">, id: string): Promise<void> {
  await call(db, `${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

// ---------------- connecting an account (OAuth) ----------------

export function driveAuthUrl(redirectUri: string, state: string): string | null {
  const client = oauthClient();
  if (!client) return null;
  const q = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `${OAUTH_SCOPE} openid email`,
    access_type: "offline",
    prompt: "consent", // always hand back a refresh token, also when reconnecting
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function connectDrive(db: Db, code: string, redirectUri: string, userId: number): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> {
  const client = oauthClient();
  if (!client) return { ok: false, error: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server first" };
  let r;
  try {
    r = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: client.id, client_secret: client.secret });
  } catch (e) {
    return { ok: false, error: e instanceof DriveError ? e.message : "Google sign-in failed" };
  }
  if (!r.refresh_token) return { ok: false, error: "Google did not grant offline access; try connecting again" };
  let email: string | null = null;
  try {
    const me = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${r.access_token}` }, signal: AbortSignal.timeout(15_000) });
    email = me.ok ? (((await me.json()) as { email?: string }).email ?? null) : null;
  } catch {
    // the address is only shown in Settings
  }
  const prev = await stored(db);
  // reconnecting the same account keeps its folder; another account starts its own
  const folderId = prev && prev.email === email ? prev.folderId : null;
  await store(db, { refreshToken: sealSecret(r.refresh_token, SEAL), email, folderId, connectedAt: new Date().toISOString() }, userId);
  cached = null;
  await audit(db, { userId, entity: "google_drive", action: "connect", diff: { account: email } });
  return { ok: true, email };
}

/** Forgets the account and revokes the app's access. Files already in Drive stay there, but the app can open them
 * again only once the same account is reconnected. */
export async function disconnectDrive(db: Db, userId: number) {
  const s = await stored(db);
  if (!s) return;
  const refresh = openSecret(s.refreshToken, SEAL);
  if (refresh) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST", signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  await db.delete(appSettings).where(eq(appSettings.key, SETTING));
  cached = null;
  await audit(db, { userId, entity: "google_drive", action: "disconnect", diff: { account: s.email } });
}

/** Tests only: forget the cached access token. */
export const resetDriveCache = () => {
  cached = null;
};
