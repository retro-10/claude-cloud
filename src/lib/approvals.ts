import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { approvalEvents, approvalRequests, calendarEvents, campaigns, ledgerEntries, notifications, users } from "@/db/schema";
import { getSetting, type ApprovalRule } from "./app-settings";
import { addAttachment, fileProblem, listAttachments } from "./attachments";
import { audit } from "./audit";
import { SECTIONS, saveEntry, type Section } from "./finance";
import type { Fail } from "./result";
import { allDayRange } from "./calendar";

// Approvals (HQ brief: request form, routing rules, approver queue, immutable record). One engine for every kind of
// request; any one of the people the rules name decides; nobody decides their own request.

export const APPROVAL_TYPES = [
  { key: "expense", label: "Expense", hint: "Money already spent or to be paid back to you", money: true },
  { key: "purchase", label: "Purchase", hint: "Something to buy before spending", money: true },
  { key: "leave", label: "Leave", hint: "Days off; once approved they show on the team calendar", money: false },
  { key: "brand", label: "Brand or design request", hint: "A design, post or asset from the brand team", money: false },
  { key: "other", label: "Other", hint: "Anything else that needs a yes", money: false },
] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number]["key"];
export const typeOf = (k: string) => APPROVAL_TYPES.find((t) => t.key === k) ?? APPROVAL_TYPES[4];

export const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  needs_info: "Needs info",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
const OPEN = ["pending", "needs_info"];

/** Money requests use the ledger's cost categories, so an approved one lands in the books already sorted. */
export const COST_CATEGORIES = [...SECTIONS.variable_costs.categories, ...SECTIONS.fixed_costs.categories];
export const UNCATEGORISED = "Uncategorised";
const sectionOf = (category: string): Section => (SECTIONS.fixed_costs.categories.includes(category) ? "fixed_costs" : "variable_costs");

export type Viewer = { id: number; name: string; isOwner: boolean; isFinance: boolean };
type Request = typeof approvalRequests.$inferSelect;

export const approvalLink = (id: number) => `/approvals/${id}`;

// ---------------- routing ----------------

/** The rule a request falls under: the first whose type matches and whose minimum amount it reaches. */
export function matchRule(rules: ApprovalRule[], type: string, amountEgp: number | null): ApprovalRule | null {
  return rules.find((r) => (r.type === "*" || r.type === type) && (r.minAmountEgp === null || (amountEgp ?? 0) >= r.minAmountEgp)) ?? null;
}

/** Who may approve: the rule's people, active, never the requester. If that leaves nobody, the owners do. */
export async function resolveApprovers(db: Db, type: string, amountEgp: number | null, requesterId: number): Promise<number[]> {
  const rule = matchRule(await getSetting(db, "approvalRules"), type, amountEgp);
  const active = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.active, true));
  const pick = (who: string[]) =>
    active
      .filter((u) => who.some((w) => (w === "owners" && u.role === "owner") || (w === "finance" && u.role === "finance") || w === `user:${u.id}`))
      .map((u) => u.id)
      .filter((id) => id !== requesterId);
  const ids = pick(rule?.approvers ?? ["owners"]);
  return ids.length ? ids : pick(["owners"]);
}

async function notify(db: Db, userIds: number[], kind: string, title: string, id: number) {
  if (userIds.length) await db.insert(notifications).values(userIds.map((userId) => ({ userId, kind, title, link: approvalLink(id) })));
}

/** Clears the "waiting for you" notifications of a request once it is decided or withdrawn. */
async function clearNotes(db: Db, id: number) {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.link, approvalLink(id)), eq(notifications.kind, "approval_request"), isNull(notifications.readAt)));
}

const event = (db: Db, requestId: number, userId: number | null, action: string, note?: string | null) =>
  db.insert(approvalEvents).values({ requestId, userId, action, note: note?.trim() || null });

// ---------------- asking ----------------

export type RequestInput = {
  type: string;
  title: string;
  details?: string | null;
  amountEgp?: number | null;
  category?: string | null;
  campaignId?: number | null;
  startsOn?: string | null;
  endsOn?: string | null;
};
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Submit a request. A money request may carry a receipt or quote (checked before anything is saved). */
export async function submitRequest(
  db: Db,
  me: { id: number; name: string },
  input: RequestInput,
  receipt: { name: string; bytes: Buffer } | null = null,
): Promise<{ ok: true; id: number; approvers: number[] } | Fail> {
  const t = APPROVAL_TYPES.find((x) => x.key === input.type);
  if (!t) return { ok: false, error: "Pick what kind of request this is" };
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Say in a few words what you are asking for" };
  let amount: number | null = null;
  if (t.money) {
    if (!Number.isInteger(input.amountEgp) || input.amountEgp! <= 0) return { ok: false, error: "Give the amount in EGP" };
    amount = input.amountEgp!;
    if (input.category?.trim() && !COST_CATEGORIES.includes(input.category.trim())) return { ok: false, error: "Pick a category from the list, or leave it for finance" };
    if (receipt) {
      const bad = fileProblem(receipt);
      if (bad) return { ok: false, error: `Receipt: ${bad}` };
    }
  }
  let startsOn: string | null = null;
  let endsOn: string | null = null;
  if (t.key === "leave") {
    if (!input.startsOn || !YMD.test(input.startsOn)) return { ok: false, error: "Give the first day of leave" };
    endsOn = input.endsOn && YMD.test(input.endsOn) ? input.endsOn : input.startsOn;
    if (endsOn < input.startsOn) return { ok: false, error: "The last day must be on or after the first" };
    startsOn = input.startsOn;
  }
  if (input.campaignId) {
    const [c] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, input.campaignId));
    if (!c) return { ok: false, error: "That campaign does not exist" };
  }
  const approvers = await resolveApprovers(db, t.key, amount, me.id);
  if (!approvers.length) return { ok: false, error: "Nobody else can approve this yet: add another owner in Settings > Users" };
  const [row] = await db
    .insert(approvalRequests)
    .values({
      type: t.key,
      title,
      details: input.details?.trim().slice(0, 4000) || null,
      amountEgp: amount,
      category: t.money ? input.category?.trim().slice(0, 60) || null : null,
      campaignId: input.campaignId ?? null,
      startsOn,
      endsOn,
      requesterId: me.id,
      approverIds: approvers,
    })
    .returning({ id: approvalRequests.id });
  await event(db, row.id, me.id, "submit", null);
  if (t.money && receipt) await addAttachment(db, receipt, { approvalId: row.id, note: "Receipt" }, me.id);
  await notify(db, approvers, "approval_request", `${me.name} asks: ${title}`, row.id);
  await audit(db, { userId: me.id, entity: "approval", entityId: row.id, action: "submit", diff: { type: t.key, amountEgp: amount } });
  return { ok: true, id: row.id, approvers };
}

// ---------------- deciding ----------------

async function load(db: Db, id: number) {
  const [r] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
  return r ?? null;
}

export const canDecide = (r: Pick<Request, "approverIds" | "requesterId" | "status">, userId: number) =>
  OPEN.includes(r.status) && r.requesterId !== userId && r.approverIds.includes(userId);

/** Approve, reject (reason required) or ask for more information (question required). */
export async function decide(db: Db, me: { id: number; name: string }, id: number, decision: "approve" | "reject" | "needs_info", note?: string | null): Promise<{ ok: true } | Fail> {
  const r = await load(db, id);
  if (!r) return { ok: false, error: "That request does not exist" };
  if (r.requesterId === me.id) return { ok: false, error: "You cannot decide your own request" };
  if (!r.approverIds.includes(me.id)) return { ok: false, error: "You are not an approver for this request" };
  if (!OPEN.includes(r.status)) return { ok: false, error: `This request is already ${STATUS_LABEL[r.status]?.toLowerCase() ?? r.status}` };
  const text = note?.trim() ?? "";
  if (decision !== "approve" && !text) return { ok: false, error: decision === "reject" ? "Say why it is rejected" : "Say what you need to know" };
  const now = new Date();
  if (decision === "needs_info") {
    await db.update(approvalRequests).set({ status: "needs_info", updatedAt: now }).where(eq(approvalRequests.id, id));
    await event(db, id, me.id, "needs_info", text);
    await notify(db, [r.requesterId], "approval_question", `${me.name} needs more on: ${r.title}`, id);
    return { ok: true };
  }
  // the update only wins if nobody else decided first
  const done = await db
    .update(approvalRequests)
    .set({ status: decision === "approve" ? "approved" : "rejected", decidedBy: me.id, decidedAt: now, updatedAt: now })
    .where(and(eq(approvalRequests.id, id), inArray(approvalRequests.status, OPEN)))
    .returning({ id: approvalRequests.id });
  if (!done.length) return { ok: false, error: "Someone else decided this a moment ago" };
  await event(db, id, me.id, decision === "approve" ? "approve" : "reject", text || null);
  if (decision === "approve" && r.type === "leave" && r.startsOn && r.endsOn) {
    const range = allDayRange(r.startsOn, r.endsOn);
    const [ev] = await db
      .insert(calendarEvents)
      .values({ userId: r.requesterId, title: r.title, kind: "leave", startsAt: range.start!, endsAt: range.end!, allDay: true, note: "Approved leave", createdBy: me.id })
      .returning({ id: calendarEvents.id });
    await db.update(approvalRequests).set({ calendarEventId: ev.id }).where(eq(approvalRequests.id, id));
  }
  if (decision === "approve" && typeOf(r.type).money && r.amountEgp) await toLedger(db, r, me.id);
  await clearNotes(db, id);
  await notify(db, [r.requesterId], decision === "approve" ? "approval_approved" : "approval_rejected", `${me.name} ${decision === "approve" ? "approved" : "rejected"}: ${r.title}`, id);
  await audit(db, { userId: me.id, entity: "approval", entityId: id, action: decision });
  return { ok: true };
}

/**
 * An approved expense or purchase becomes an Owed cost in the ledger, tagged to its campaign, so it counts against the
 * campaign's budget at once and finance marks it Paid when the money goes out (an expense: paid back to the person
 * who asked). A category outside the ledger's list arrives as Uncategorised for finance to sort.
 */
async function toLedger(db: Db, r: Request, approverId: number) {
  const [who] = await db.select({ name: users.name }).from(users).where(eq(users.id, r.requesterId));
  const category = r.category && COST_CATEGORIES.includes(r.category) ? r.category : UNCATEGORISED;
  const saved = await saveEntry(
    db,
    null,
    {
      entry: r.title,
      amountEgp: r.amountEgp!,
      section: sectionOf(category),
      category,
      status: "owed",
      fromTo: r.type === "expense" ? (who?.name ?? null) : null,
      reference: `Request #${r.id}`,
      notes: r.type === "expense" ? "Approved expense: pay it back to the person who asked" : "Approved purchase",
      campaignId: r.campaignId,
    },
    approverId,
  );
  if (saved.ok) await db.update(approvalRequests).set({ ledgerEntryId: saved.id }).where(eq(approvalRequests.id, r.id));
}

/** The requester answers a question; the request goes back to the approvers. */
export async function reply(db: Db, me: { id: number; name: string }, id: number, note: string): Promise<{ ok: true } | Fail> {
  const r = await load(db, id);
  if (!r || r.requesterId !== me.id) return { ok: false, error: "Only the person who asked can answer" };
  if (r.status !== "needs_info") return { ok: false, error: "Nobody asked a question on this request" };
  if (!note.trim()) return { ok: false, error: "Write your answer" };
  await db.update(approvalRequests).set({ status: "pending", updatedAt: new Date() }).where(eq(approvalRequests.id, id));
  await event(db, id, me.id, "reply", note);
  await notify(db, r.approverIds, "approval_request", `${me.name} answered: ${r.title}`, id);
  return { ok: true };
}

export async function cancelRequest(db: Db, me: { id: number }, id: number): Promise<{ ok: true } | Fail> {
  const r = await load(db, id);
  if (!r || r.requesterId !== me.id) return { ok: false, error: "Only the person who asked can withdraw it" };
  if (!OPEN.includes(r.status)) return { ok: false, error: "It has already been decided" };
  await db.update(approvalRequests).set({ status: "cancelled", updatedAt: new Date() }).where(eq(approvalRequests.id, id));
  await event(db, id, me.id, "cancel", null);
  await clearNotes(db, id);
  return { ok: true };
}

// ---------------- reading ----------------

/** Requesters see theirs, approvers what they may decide, owners everything, finance every money request. */
export const mayView = (r: Pick<Request, "requesterId" | "approverIds" | "type">, v: Viewer) =>
  v.isOwner || r.requesterId === v.id || r.approverIds.includes(v.id) || (v.isFinance && typeOf(r.type).money);

const listCols = {
  r: approvalRequests,
  requester: users.name,
};

export type ApprovalRow = Request & { requester: string };

/** What is waiting for me, oldest first: the queue is worked by waiting time. */
export async function waitingFor(db: Db, userId: number): Promise<ApprovalRow[]> {
  const rows = await db
    .select(listCols)
    .from(approvalRequests)
    .innerJoin(users, eq(users.id, approvalRequests.requesterId))
    .where(and(eq(approvalRequests.status, "pending"), sql`${userId} = any(${approvalRequests.approverIds})`))
    .orderBy(asc(approvalRequests.createdAt));
  return rows.map((x) => ({ ...x.r, requester: x.requester }));
}

export async function myRequests(db: Db, userId: number, limit = 100): Promise<ApprovalRow[]> {
  const rows = await db
    .select(listCols)
    .from(approvalRequests)
    .innerJoin(users, eq(users.id, approvalRequests.requesterId))
    .where(eq(approvalRequests.requesterId, userId))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(limit);
  return rows.map((x) => ({ ...x.r, requester: x.requester }));
}

/** Everything a viewer may see (owners: all; finance: plus every money request), newest first. */
export async function allRequests(db: Db, v: Viewer, limit = 200): Promise<ApprovalRow[]> {
  const rows = await db
    .select(listCols)
    .from(approvalRequests)
    .innerJoin(users, eq(users.id, approvalRequests.requesterId))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(limit);
  return rows.map((x) => ({ ...x.r, requester: x.requester })).filter((r) => mayView(r, v));
}

export async function waitingCount(db: Db, userId: number): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.status, "pending"), sql`${userId} = any(${approvalRequests.approverIds})`));
  return r.n;
}

export async function getRequest(db: Db, id: number, v: Viewer) {
  const r = await load(db, id);
  if (!r || !mayView(r, v)) return null;
  const people = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [r.requesterId, ...r.approverIds, ...(r.decidedBy ? [r.decidedBy] : [])]));
  const name = (uid: number | null) => people.find((p) => p.id === uid)?.name ?? "Someone";
  const events = await db
    .select({ e: approvalEvents, who: users.name })
    .from(approvalEvents)
    .leftJoin(users, eq(users.id, approvalEvents.userId))
    .where(eq(approvalEvents.requestId, id))
    .orderBy(asc(approvalEvents.id));
  const [campaign] = r.campaignId ? await db.select({ id: campaigns.id, name: campaigns.label }).from(campaigns).where(eq(campaigns.id, r.campaignId)) : [];
  const [ledger] = r.ledgerEntryId ? await db.select({ id: ledgerEntries.id, status: ledgerEntries.status, category: ledgerEntries.category }).from(ledgerEntries).where(eq(ledgerEntries.id, r.ledgerEntryId)) : [];
  const files = typeOf(r.type).money ? await listAttachments(db, { approvalId: r.id }) : [];
  return {
    ...r,
    requester: name(r.requesterId),
    approvers: r.approverIds.map((uid) => ({ id: uid, name: name(uid) })),
    decider: r.decidedBy ? name(r.decidedBy) : null,
    campaign: campaign ?? null,
    ledger: ledger ?? null,
    files,
    events: events.map((x) => ({ ...x.e, who: x.who ?? "HQ" })),
  };
}

/** For the request form: who would approve this type (and amount), by name. */
export async function previewApprovers(db: Db, type: string, amountEgp: number | null, requesterId: number) {
  const ids = await resolveApprovers(db, type, amountEgp, requesterId);
  if (!ids.length) return [];
  return db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)).orderBy(asc(users.name));
}
