import bcrypt from "bcryptjs";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cadenceTemplates, campaigns, followUps, leads, lostReasons, objections, sources, stages, users, consultObjections } from "@/db/schema";
import type { CadenceStep } from "@/db/schema";
import { audit } from "./audit";
import { isUniqueViolation } from "./db-errors";
import type { Role } from "./rbac";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const MIN_PASSWORD = 10;
export const passwordProblem = (pw: string): string | null =>
  pw.length < MIN_PASSWORD ? `Password must be at least ${MIN_PASSWORD} characters` : pw.length > 200 ? "Password is too long" : null;

const hash = (pw: string) => bcrypt.hash(pw, 12);
const EMAIL = /^[^\s@]+@[^\s@]+$/; // internal tool: local hosts like x@orladent.local are valid

// ---------------- users ----------------

export async function createUser(
  db: Db,
  input: { name: string; email: string; role: Role; password: string },
  actorId: number | null,
): Promise<Result<{ id: number }>> {
  const email = input.email.trim().toLowerCase();
  if (!input.name.trim()) return { ok: false, error: "Name is required" };
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid email" };
  const bad = passwordProblem(input.password);
  if (bad) return { ok: false, error: bad };
  try {
    const [u] = await db
      .insert(users)
      .values({ name: input.name.trim(), email, role: input.role, passwordHash: await hash(input.password) })
      .returning({ id: users.id });
    await audit(db, { userId: actorId, entity: "user", entityId: u.id, action: "create", diff: { role: input.role } });
    return { ok: true, id: u.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "That email is already used" };
    throw e;
  }
}

// The system must always keep at least one active owner, or nobody could manage users again.
async function otherActiveOwners(tx: Pick<Db, "select">, exceptId: number) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.active, true), ne(users.id, exceptId)));
  return r.n;
}

export async function updateUser(
  db: Db,
  id: number,
  patch: { role?: Role; active?: boolean; name?: string },
  actorId: number | null,
): Promise<Result> {
  return db.transaction(async (tx): Promise<Result> => {
    const [u] = await tx.select().from(users).where(eq(users.id, id)).for("update");
    if (!u) return { ok: false, error: "User not found" };
    const willBeOwner = (patch.role ?? u.role) === "owner" && (patch.active ?? u.active);
    if (u.role === "owner" && u.active && !willBeOwner && (await otherActiveOwners(tx, id)) === 0) {
      return { ok: false, error: "There must be at least one active owner" };
    }
    if (patch.name !== undefined && !patch.name.trim()) return { ok: false, error: "Name is required" };
    await tx
      .update(users)
      .set({ role: patch.role ?? u.role, active: patch.active ?? u.active, name: patch.name?.trim() ?? u.name })
      .where(eq(users.id, id));
    await audit(tx, { userId: actorId, entity: "user", entityId: id, action: "update", diff: { fields: Object.keys(patch) } });
    return { ok: true };
  });
}

// Owner resets someone's password (they should change it after signing in).
export async function resetPassword(db: Db, id: number, newPassword: string, actorId: number | null): Promise<Result> {
  const bad = passwordProblem(newPassword);
  if (bad) return { ok: false, error: bad };
  const rows = await db
    .update(users)
    .set({ passwordHash: await hash(newPassword), passwordChangedAt: null })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!rows.length) return { ok: false, error: "User not found" };
  await audit(db, { userId: actorId, entity: "user", entityId: id, action: "password_reset" });
  return { ok: true };
}

export async function changeOwnPassword(db: Db, userId: number, current: string, next: string): Promise<Result> {
  const bad = passwordProblem(next);
  if (bad) return { ok: false, error: bad };
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !(await bcrypt.compare(current, u.passwordHash))) return { ok: false, error: "Current password is wrong" };
  if (current === next) return { ok: false, error: "Choose a different password" };
  await db.update(users).set({ passwordHash: await hash(next), passwordChangedAt: new Date() }).where(eq(users.id, userId));
  await audit(db, { userId, entity: "user", entityId: userId, action: "password_change" });
  return { ok: true };
}

// ---------------- stages: label and order only ----------------

export async function renameStage(db: Db, key: string, label: string, actorId: number | null): Promise<Result> {
  if (!label.trim() || label.length > 60) return { ok: false, error: "Label must be 1-60 characters" };
  const rows = await db.update(stages).set({ label: label.trim() }).where(eq(stages.key, key)).returning({ id: stages.id });
  if (!rows.length) return { ok: false, error: "Stage not found" };
  await audit(db, { userId: actorId, entity: "stage", entityId: key, action: "rename" });
  return { ok: true };
}

// Swap positions with the neighbour. Position decides board column order, the funnel order and which
// stage counts as "earlier" for automatic moves, so it always stays a strict order.
export async function moveStage(db: Db, key: string, direction: "up" | "down", actorId: number | null): Promise<Result> {
  return db.transaction(async (tx): Promise<Result> => {
    const list = await tx.select().from(stages).orderBy(asc(stages.position)).for("update");
    const i = list.findIndex((s) => s.key === key);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0) return { ok: false, error: "Stage not found" };
    if (j < 0 || j >= list.length) return { ok: true };
    // re-number 1..n so positions stay unique even if they had gaps
    const order = list.map((s) => s.key);
    [order[i], order[j]] = [order[j], order[i]];
    for (const [idx, k] of order.entries()) await tx.update(stages).set({ position: idx + 1 }).where(eq(stages.key, k));
    await audit(tx, { userId: actorId, entity: "stage", entityId: key, action: `move_${direction}` });
    return { ok: true };
  });
}

// ---------------- simple lists: sources, lost reasons, objection tags ----------------

const LISTS = { sources, lostReasons, objections } as const;
export type ListName = keyof typeof LISTS;

// where a label is referenced, deleting it would orphan or rewrite history
const usage: Record<ListName, (db: Pick<Db, "select">, id: number) => Promise<number>> = {
  sources: async (db, id) => {
    const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.sourceId, id));
    const [b] = await db.select({ n: sql<number>`count(*)::int` }).from(campaigns).where(eq(campaigns.sourceId, id));
    return a.n + b.n;
  },
  lostReasons: async (db, id) => (await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.lostReasonId, id)))[0].n,
  objections: async (db, id) => (await db.select({ n: sql<number>`count(*)::int` }).from(consultObjections).where(eq(consultObjections.objectionId, id)))[0].n,
};

export async function addListItem(db: Db, list: ListName, label: string, actorId: number | null): Promise<Result> {
  const l = label.trim();
  if (!l || l.length > 80) return { ok: false, error: "Label must be 1-80 characters" };
  try {
    const t = LISTS[list];
    const [row] = await db.insert(t).values({ label: l }).returning({ id: t.id });
    await audit(db, { userId: actorId, entity: list, entityId: row.id, action: "create" });
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "That label already exists" };
    throw e;
  }
}

export async function renameListItem(db: Db, list: ListName, id: number, label: string, actorId: number | null): Promise<Result> {
  const l = label.trim();
  if (!l || l.length > 80) return { ok: false, error: "Label must be 1-80 characters" };
  try {
    const t = LISTS[list];
    const rows = await db.update(t).set({ label: l }).where(eq(t.id, id)).returning({ id: t.id });
    if (!rows.length) return { ok: false, error: "Not found" };
    await audit(db, { userId: actorId, entity: list, entityId: id, action: "rename" });
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "That label already exists" };
    throw e;
  }
}

export async function deleteListItem(db: Db, list: ListName, id: number, actorId: number | null): Promise<Result> {
  const n = await usage[list](db, id);
  if (n > 0) return { ok: false, error: `In use by ${n} record${n === 1 ? "" : "s"}; rename it instead` };
  const t = LISTS[list];
  const rows = await db.delete(t).where(eq(t.id, id)).returning({ id: t.id });
  if (!rows.length) return { ok: false, error: "Not found" };
  await audit(db, { userId: actorId, entity: list, entityId: id, action: "delete" });
  return { ok: true };
}

// ---------------- campaigns ----------------

export async function addCampaign(db: Db, label: string, sourceId: number | null, actorId: number | null): Promise<Result> {
  const l = label.trim();
  if (!l || l.length > 80) return { ok: false, error: "Label must be 1-80 characters" };
  const [row] = await db.insert(campaigns).values({ label: l, sourceId, startedAt: new Date() }).returning({ id: campaigns.id });
  await audit(db, { userId: actorId, entity: "campaign", entityId: row.id, action: "create" });
  return { ok: true };
}

export async function renameCampaign(db: Db, id: number, label: string, actorId: number | null): Promise<Result> {
  const l = label.trim();
  if (!l || l.length > 80) return { ok: false, error: "Label must be 1-80 characters" };
  const rows = await db.update(campaigns).set({ label: l }).where(eq(campaigns.id, id)).returning({ id: campaigns.id });
  if (!rows.length) return { ok: false, error: "Not found" };
  await audit(db, { userId: actorId, entity: "campaign", entityId: id, action: "rename" });
  return { ok: true };
}

export async function deleteCampaign(db: Db, id: number, actorId: number | null): Promise<Result> {
  const [u] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.campaignId, id));
  if (u.n > 0) return { ok: false, error: `In use by ${u.n} lead${u.n === 1 ? "" : "s"}; rename it instead` };
  const rows = await db.delete(campaigns).where(eq(campaigns.id, id)).returning({ id: campaigns.id });
  if (!rows.length) return { ok: false, error: "Not found" };
  await audit(db, { userId: actorId, entity: "campaign", entityId: id, action: "delete" });
  return { ok: true };
}

// ---------------- cadence templates ----------------

export const STEP_KINDS = ["whatsapp", "call", "instagram", "linkedin", "email", "other"];

/** One step per line: `offset_days | kind | message hint` (kind and hint optional). */
export function parseSteps(text: string): { ok: true; steps: CadenceStep[] } | { ok: false; error: string } {
  const steps: CadenceStep[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ok: false, error: "Add at least one step" };
  if (lines.length > 30) return { ok: false, error: "At most 30 steps" };
  for (const [i, line] of lines.entries()) {
    const [off, kind = "whatsapp", ...hint] = line.split("|").map((p) => p.trim());
    if (!/^\d{1,3}$/.test(off)) return { ok: false, error: `Line ${i + 1}: start with the day number (0-365), e.g. "4 | whatsapp | Value clip"` };
    if (Number(off) > 365) return { ok: false, error: `Line ${i + 1}: day must be 0-365` };
    if (!STEP_KINDS.includes(kind || "whatsapp")) return { ok: false, error: `Line ${i + 1}: kind must be one of ${STEP_KINDS.join(", ")}` };
    const message_hint = hint.join(" | ").slice(0, 500);
    steps.push({ offset_days: Number(off), kind: kind || "whatsapp", message_hint });
  }
  return { ok: true, steps: steps.sort((a, b) => a.offset_days - b.offset_days) };
}

export const stepsToText = (steps: CadenceStep[]) => steps.map((s) => `${s.offset_days} | ${s.kind} | ${s.message_hint}`).join("\n");

export async function saveTemplate(db: Db, id: number | null, name: string, stepsText: string, actorId: number | null): Promise<Result> {
  const n = name.trim();
  if (!n || n.length > 80) return { ok: false, error: "Name must be 1-80 characters" };
  const parsed = parseSteps(stepsText);
  if (!parsed.ok) return parsed;
  try {
    if (id === null) {
      const [row] = await db.insert(cadenceTemplates).values({ name: n, steps: parsed.steps }).returning({ id: cadenceTemplates.id });
      await audit(db, { userId: actorId, entity: "cadence", entityId: row.id, action: "create" });
    } else {
      // editing only affects cadences applied from now on; follow-ups already created keep their dates
      const rows = await db.update(cadenceTemplates).set({ name: n, steps: parsed.steps }).where(eq(cadenceTemplates.id, id)).returning({ id: cadenceTemplates.id });
      if (!rows.length) return { ok: false, error: "Template not found" };
      await audit(db, { userId: actorId, entity: "cadence", entityId: id, action: "update" });
    }
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "A template with that name already exists" };
    throw e;
  }
}

export async function deleteTemplate(db: Db, id: number, actorId: number | null): Promise<Result> {
  const [u] = await db.select({ n: sql<number>`count(*)::int` }).from(followUps).where(eq(followUps.templateId, id));
  if (u.n > 0) return { ok: false, error: `${u.n} follow-ups came from this template; edit it instead of deleting` };
  const rows = await db.delete(cadenceTemplates).where(eq(cadenceTemplates.id, id)).returning({ id: cadenceTemplates.id });
  if (!rows.length) return { ok: false, error: "Template not found" };
  await audit(db, { userId: actorId, entity: "cadence", entityId: id, action: "delete" });
  return { ok: true };
}
