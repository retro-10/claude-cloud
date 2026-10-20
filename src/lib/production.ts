import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { attachments, caseTypes, productionCases, productionClients, users, type QcCheck } from "@/db/schema";
import { audit } from "./audit";
import { isUniqueViolation } from "./db-errors";
import { saveEntry } from "./finance";
import { normalizePhone } from "./phone";
import { dueAtFor, quote } from "./production-quote";
import { can, type Role } from "./rbac";
import { cairoYmd } from "./time";

type Fail = { ok: false; error: string };
type Result<T = object> = ({ ok: true } & T) | Fail;
const clean = (s: string | null | undefined, n: number) => (s?.trim() ? s.trim().slice(0, n) : null);

export const CLIENT_KIND = { clinic: "Clinic", lab: "Lab", other: "Other" } as const;
export const CASE_STATUS = {
  received: "Received",
  assigned: "Assigned",
  designing: "Designing",
  qc: "QC",
  delivered: "Delivered",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
} as const;
export type CaseStatus = keyof typeof CASE_STATUS;
export const OPEN_STATUSES: CaseStatus[] = ["received", "assigned", "designing", "qc"];
/** Used when a case type has no checklist of its own. */
export const DEFAULT_QC = ["Matches the prescription", "Margins and fit", "Contacts and occlusion", "Exported in the format the client asked for"];
export const caseCode = (id: number) => `PC-${String(id).padStart(4, "0")}`;

/** Who is looking: designers see only the cases assigned to them; managers and finance see all. */
export type Viewer = { id: number; role: Role };
export const seesAllCases = (v: Viewer) => can(v.role, "production:manage") || can(v.role, "finance:read");
/** Prices, invoices and client balances: owners and finance. A designer sees only their own pay. */
export const seesMoney = (v: Viewer) => can(v.role, "finance:read");

// ---------------- clients ----------------

export type ClientInput = {
  name: string;
  kind: keyof typeof CLIENT_KIND;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  discountPct: number;
  paymentTermsDays: number;
  notes?: string | null;
  active?: boolean;
};

export async function saveClient(db: Db, id: number | null, c: ClientInput, userId: number | null): Promise<Result<{ id: number }>> {
  const name = clean(c.name, 200);
  if (!name) return { ok: false, error: "Name the clinic or lab" };
  if (!(c.kind in CLIENT_KIND)) return { ok: false, error: "Choose clinic, lab or other" };
  if (!Number.isInteger(c.discountPct) || c.discountPct < 0 || c.discountPct > 50) return { ok: false, error: "The discount is 0 to 50%" };
  if (!Number.isInteger(c.paymentTermsDays) || c.paymentTermsDays < 0 || c.paymentTermsDays > 120) return { ok: false, error: "Payment terms are 0 to 120 days" };
  const email = clean(c.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Check the email address" };
  const rawPhone = clean(c.phone, 40);
  const phone = rawPhone ? (normalizePhone(rawPhone) ?? null) : null;
  if (rawPhone && !phone) return { ok: false, error: "Check the phone number" };
  const values = {
    name,
    kind: c.kind,
    contactName: clean(c.contactName, 200),
    phone,
    email,
    address: clean(c.address, 500),
    discountPct: c.discountPct,
    paymentTermsDays: c.paymentTermsDays,
    notes: clean(c.notes, 4000),
    active: c.active ?? true,
    updatedAt: new Date(),
  };
  if (id) {
    const r = await db.update(productionClients).set(values).where(eq(productionClients.id, id)).returning({ id: productionClients.id });
    if (!r.length) return { ok: false, error: "Client not found" };
  } else {
    [{ id }] = await db.insert(productionClients).values(values).returning({ id: productionClients.id });
  }
  await audit(db, { userId, entity: "production_client", entityId: id, action: "save", diff: { discountPct: c.discountPct, paymentTermsDays: c.paymentTermsDays } });
  return { ok: true, id };
}

export async function listClients(db: Db, f: { activeOnly?: boolean } = {}) {
  const rows = await db
    .select({
      c: productionClients,
      // written out in full: in the select list of a query without a join drizzle leaves "id" unqualified, which
      // inside these subqueries would mean the subquery's own id
      open: sql<number>`(select count(*) from production_cases x where x.client_id = production_clients.id and x.status in ('received', 'assigned', 'designing', 'qc'))::int`,
      toInvoice: sql<number>`(select count(*) from production_cases x where x.client_id = production_clients.id and x.status = 'delivered')::int`,
      // what their issued invoices are still owed: the Expected client-work rows linked to them
      owed: sql<number>`(select coalesce(sum(l.amount_egp), 0) from ledger_entries l join invoices i on i.id = l.invoice_id
        where i.client_id = production_clients.id and l.deleted_at is null and l.status = 'expected')::int`,
    })
    .from(productionClients)
    .where(f.activeOnly ? eq(productionClients.active, true) : undefined)
    .orderBy(desc(productionClients.active), asc(productionClients.name));
  return rows.map((r) => ({ ...r.c, open: Number(r.open), toInvoice: Number(r.toInvoice), owed: Number(r.owed) }));
}

export async function getClient(db: Db, id: number) {
  const [c] = await db.select().from(productionClients).where(eq(productionClients.id, id));
  return c ?? null;
}

// ---------------- the price list ----------------

/** One checklist item per line; 1 to 15 items of up to 120 characters. Empty = the default checklist. */
export function parseChecklist(text: string): string[] | string {
  const items = [...new Set(text.split(/\r?\n/).map((l) => l.replace(/^[-*•\s]+/, "").trim()).filter(Boolean))];
  if (items.length > 15) return "Keep the checklist to 15 items";
  if (items.some((i) => i.length > 120)) return "Keep each checklist item under 120 characters";
  return items;
}

export type CaseTypeInput = {
  name: string;
  unitPriceEgp: number;
  designerPayEgp: number;
  standardDays: number;
  rushDays: number;
  rushSurchargePct: number;
  qcChecklist: string[];
  active?: boolean;
};

export async function saveCaseType(db: Db, id: number | null, t: CaseTypeInput, userId: number | null): Promise<Result<{ id: number }>> {
  const name = clean(t.name, 80);
  if (!name) return { ok: false, error: "Name the case type" };
  const whole = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!whole(t.unitPriceEgp, 1, 1_000_000)) return { ok: false, error: "The unit price is a whole number of EGP above zero" };
  if (!whole(t.designerPayEgp, 0, 1_000_000)) return { ok: false, error: "Designer pay is a whole number of EGP" };
  if (t.designerPayEgp > t.unitPriceEgp) return { ok: false, error: "Designer pay cannot be more than the price" };
  if (!whole(t.standardDays, 0, 60) || !whole(t.rushDays, 0, 60)) return { ok: false, error: "Turnaround is 0 to 60 working days" };
  if (t.rushDays > t.standardDays) return { ok: false, error: "Rush must be quicker than standard" };
  if (!whole(t.rushSurchargePct, 0, 300)) return { ok: false, error: "The rush surcharge is 0 to 300%" };
  const values = {
    name,
    unitPriceEgp: t.unitPriceEgp,
    designerPayEgp: t.designerPayEgp,
    standardDays: t.standardDays,
    rushDays: t.rushDays,
    rushSurchargePct: t.rushSurchargePct,
    qcChecklist: t.qcChecklist,
    active: t.active ?? true,
    updatedAt: new Date(),
  };
  try {
    if (id) {
      const r = await db.update(caseTypes).set(values).where(eq(caseTypes.id, id)).returning({ id: caseTypes.id });
      if (!r.length) return { ok: false, error: "Case type not found" };
    } else {
      [{ id }] = await db.insert(caseTypes).values(values).returning({ id: caseTypes.id });
    }
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "There is already a case type with that name" };
    throw e;
  }
  await audit(db, { userId, entity: "case_type", entityId: id, action: "save", diff: { unitPriceEgp: t.unitPriceEgp, designerPayEgp: t.designerPayEgp } });
  return { ok: true, id };
}

export const listCaseTypes = (db: Db, f: { activeOnly?: boolean } = {}) =>
  db
    .select()
    .from(caseTypes)
    .where(f.activeOnly ? eq(caseTypes.active, true) : undefined)
    .orderBy(desc(caseTypes.active), asc(caseTypes.name));

// ---------------- cases ----------------

/** People a case can be given to: active designers, and owners who design. */
export const listDesigners = (db: Db) =>
  db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.active, true), inArray(users.role, ["designer", "owner"])))
    .orderBy(asc(users.name));

export type CaseInput = {
  clientId: number;
  caseTypeId: number;
  reference?: string | null;
  units: number;
  rush: boolean;
  receivedAt?: Date;
  dueAt?: Date | null; // empty = from the price list's turnaround
  designerId?: number | null;
  notes?: string | null;
};

async function checkDesigner(db: Db, id: number | null | undefined): Promise<string | null> {
  if (!id) return null;
  const [u] = await db.select({ role: users.role, active: users.active }).from(users).where(eq(users.id, id));
  if (!u || !u.active || !["designer", "owner"].includes(u.role)) return "Choose an active designer";
  return null;
}

/** Take a case in. Its price and the designer's pay are fixed now from the price list and the client's discount. */
export async function createCase(db: Db, c: CaseInput, userId: number | null): Promise<Result<{ id: number; dueAt: Date; priceEgp: number }>> {
  const [client, type] = await Promise.all([getClient(db, c.clientId), db.select().from(caseTypes).where(eq(caseTypes.id, c.caseTypeId)).then((r) => r[0])]);
  if (!client || !client.active) return { ok: false, error: "Choose an active client" };
  if (!type || !type.active) return { ok: false, error: "Choose a case type from the price list" };
  if (!Number.isInteger(c.units) || c.units < 1 || c.units > 100) return { ok: false, error: "Units are 1 to 100" };
  const bad = await checkDesigner(db, c.designerId);
  if (bad) return { ok: false, error: bad };
  const receivedAt = c.receivedAt ?? new Date();
  const q = quote({ ...type, units: c.units, rush: c.rush, discountPct: client.discountPct, receivedYmd: cairoYmd(receivedAt) });
  const dueAt = c.dueAt ?? dueAtFor(q.dueYmd);
  if (dueAt < receivedAt) return { ok: false, error: "The due date is before the case was received" };
  const [row] = await db
    .insert(productionCases)
    .values({
      clientId: c.clientId,
      caseTypeId: c.caseTypeId,
      reference: clean(c.reference, 120),
      units: c.units,
      rush: c.rush,
      status: c.designerId ? "assigned" : "received",
      receivedAt,
      dueAt,
      designerId: c.designerId ?? null,
      priceEgp: q.priceEgp,
      designerPayEgp: type.designerPayEgp * c.units,
      notes: clean(c.notes, 4000),
      createdBy: userId,
    })
    .returning({ id: productionCases.id });
  await audit(db, { userId, entity: "production_case", entityId: row.id, action: "create", diff: { priceEgp: q.priceEgp, rush: c.rush, units: c.units } });
  return { ok: true, id: row.id, dueAt, priceEgp: q.priceEgp };
}

/** The details that can change after intake (not the price: that was agreed). */
export async function updateCaseDetails(db: Db, id: number, d: { reference?: string | null; dueAt: Date; notes?: string | null }, userId: number | null): Promise<Result> {
  const r = await db
    .update(productionCases)
    .set({ reference: clean(d.reference, 120), dueAt: d.dueAt, notes: clean(d.notes, 4000), updatedAt: new Date() })
    .where(and(eq(productionCases.id, id), inArray(productionCases.status, OPEN_STATUSES)))
    .returning({ id: productionCases.id });
  if (!r.length) return { ok: false, error: "Only an open case can be changed" };
  await audit(db, { userId, entity: "production_case", entityId: id, action: "update" });
  return { ok: true };
}

type CaseRow = typeof productionCases.$inferSelect;
async function load(db: Db, id: number): Promise<CaseRow | null> {
  const [c] = await db.select().from(productionCases).where(eq(productionCases.id, id));
  return c ?? null;
}
async function setStatus(db: Db, id: number, from: CaseStatus[], set: Partial<CaseRow>, userId: number | null, action: string, diff?: Record<string, unknown>) {
  const r = await db
    .update(productionCases)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(productionCases.id, id), inArray(productionCases.status, from)))
    .returning({ id: productionCases.id });
  if (r.length) await audit(db, { userId, entity: "production_case", entityId: id, action, diff });
  return r.length > 0;
}

/** Give the case to a designer (or take it back). Allowed until it goes to QC. */
export async function assignCase(db: Db, id: number, designerId: number | null, userId: number | null): Promise<Result> {
  const bad = await checkDesigner(db, designerId);
  if (bad) return { ok: false, error: bad };
  const ok = await setStatus(db, id, ["received", "assigned", "designing"], { designerId, status: designerId ? "assigned" : "received" }, userId, "assign", { designerId });
  return ok ? { ok: true } : { ok: false, error: "Only a case that is not yet in QC can be reassigned" };
}

/** The designer starts work. Only the person it is assigned to, or a manager. */
export async function startCase(db: Db, id: number, v: Viewer): Promise<Result> {
  const c = await load(db, id);
  if (!c || (!can(v.role, "production:manage") && c.designerId !== v.id)) return { ok: false, error: "This case is not assigned to you" };
  const ok = await setStatus(db, id, ["assigned"], { status: "designing" }, v.id, "start");
  return ok ? { ok: true } : { ok: false, error: "Only an assigned case can be started" };
}

/** Designing → QC, once the design files are on the case. */
export async function sendToQc(db: Db, id: number, v: Viewer): Promise<Result> {
  const c = await load(db, id);
  if (!c || (!can(v.role, "production:manage") && c.designerId !== v.id)) return { ok: false, error: "This case is not assigned to you" };
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(attachments).where(and(eq(attachments.caseId, id), isNull(attachments.deletedAt)));
  if (!Number(n)) return { ok: false, error: "Add the design files to the case first" };
  const ok = await setStatus(db, id, ["designing"], { status: "qc", qcPassedAt: null }, v.id, "to_qc");
  return ok ? { ok: true } : { ok: false, error: "Only a case being designed can go to QC" };
}

export async function checklistFor(db: Db, caseTypeId: number) {
  const [t] = await db.select({ list: caseTypes.qcChecklist }).from(caseTypes).where(eq(caseTypes.id, caseTypeId));
  return t?.list.length ? t.list : DEFAULT_QC;
}

/**
 * QC against the case type's checklist. Every item ticked = passed (ready to deliver); anything not ticked sends
 * it back to the designer with the note, and counts against the first-time pass rate. Someone other than the
 * designer checks it.
 */
export async function reviewQc(db: Db, id: number, ticked: boolean[], note: string | null, reviewerId: number): Promise<Result<{ passed: boolean }>> {
  const c = await load(db, id);
  if (!c || c.status !== "qc") return { ok: false, error: "This case is not waiting for QC" };
  if (c.qcPassedAt) return { ok: false, error: "This case already passed QC" };
  if (c.designerId === reviewerId) return { ok: false, error: "Someone other than the designer checks the work" };
  const list = await checklistFor(db, c.caseTypeId);
  if (ticked.length !== list.length) return { ok: false, error: "Answer every checklist item" };
  const checks: QcCheck[] = list.map((item, i) => ({ item, ok: !!ticked[i] }));
  const passed = checks.every((x) => x.ok);
  const text = clean(note, 2000);
  if (!passed && !text) return { ok: false, error: "Say what to fix" };
  const set = passed
    ? { qcChecks: checks, qcNote: text, qcPassedAt: new Date(), qcBy: reviewerId }
    : { qcChecks: checks, qcNote: text, qcBy: reviewerId, status: "designing" as const, qcFails: c.qcFails + 1 };
  await setStatus(db, id, ["qc"], set, reviewerId, "qc", { passed });
  return { ok: true, passed };
}

/**
 * Sent to the client. The designer's pay for it becomes an Owed cost in the ledger (Production designers),
 * linked to the case, so the case's margin and the designer's balance are in the books.
 */
export async function deliverCase(db: Db, id: number, userId: number | null): Promise<Result> {
  const c = await load(db, id);
  if (!c || c.status !== "qc" || !c.qcPassedAt) return { ok: false, error: "A case is delivered after it passes QC" };
  const ok = await setStatus(db, id, ["qc"], { status: "delivered", deliveredAt: new Date() }, userId, "deliver");
  if (!ok) return { ok: false, error: "A case is delivered after it passes QC" };
  if (c.designerId && c.designerPayEgp > 0) {
    const [d] = await db.select({ name: users.name }).from(users).where(eq(users.id, c.designerId));
    await saveEntry(db, null, { entry: `${caseCode(id)} design — ${d?.name ?? "designer"}`, amountEgp: c.designerPayEgp, section: "variable_costs", category: "Production designers", status: "owed", fromTo: d?.name ?? null, date: new Date(), caseId: id }, userId);
  }
  return { ok: true };
}

/** Cancel a case that will not be delivered (the client withdrew it). */
export async function cancelCase(db: Db, id: number, reason: string, userId: number | null): Promise<Result> {
  const why = clean(reason, 300);
  if (!why) return { ok: false, error: "Give the reason" };
  const c = await load(db, id);
  if (!c) return { ok: false, error: "Case not found" };
  const ok = await setStatus(db, id, OPEN_STATUSES, { status: "cancelled", notes: [c.notes, `Cancelled: ${why}`].filter(Boolean).join("\n") }, userId, "cancel");
  return ok ? { ok: true } : { ok: false, error: "Only an open case can be cancelled" };
}

export type CaseListRow = Awaited<ReturnType<typeof listCases>>[number];

export async function listCases(db: Db, v: Viewer, f: { status?: CaseStatus[]; clientId?: number; designerId?: number; deliveredSince?: Date } = {}) {
  const where: (SQL | undefined)[] = [];
  if (!seesAllCases(v)) where.push(eq(productionCases.designerId, v.id));
  if (f.status?.length) where.push(inArray(productionCases.status, f.status));
  if (f.clientId) where.push(eq(productionCases.clientId, f.clientId));
  if (f.designerId) where.push(eq(productionCases.designerId, f.designerId));
  if (f.deliveredSince) where.push(sql`(${productionCases.deliveredAt} is null or ${productionCases.deliveredAt} >= ${f.deliveredSince.toISOString()}::timestamptz)`);
  const rows = await db
    .select({
      c: productionCases,
      client: productionClients.name,
      type: caseTypes.name,
      designer: users.name,
      files: sql<number>`(select count(*) from attachments a where a.case_id = ${productionCases.id} and a.deleted_at is null)::int`,
    })
    .from(productionCases)
    .innerJoin(productionClients, eq(productionClients.id, productionCases.clientId))
    .innerJoin(caseTypes, eq(caseTypes.id, productionCases.caseTypeId))
    .leftJoin(users, eq(users.id, productionCases.designerId))
    .where(and(...where))
    .orderBy(asc(productionCases.dueAt), asc(productionCases.id));
  const now = Date.now();
  return rows.map((r) => ({
    ...r.c,
    code: caseCode(r.c.id),
    client: r.client,
    type: r.type,
    designer: r.designer,
    files: Number(r.files),
    late: OPEN_STATUSES.includes(r.c.status) ? r.c.dueAt.getTime() < now : !!r.c.deliveredAt && r.c.deliveredAt > r.c.dueAt,
  }));
}

/** One case, if this person may see it. */
export async function getCase(db: Db, id: number, v: Viewer) {
  const [r] = await db
    .select({ c: productionCases, client: productionClients.name, clientId: productionClients.id, type: caseTypes.name, designer: users.name })
    .from(productionCases)
    .innerJoin(productionClients, eq(productionClients.id, productionCases.clientId))
    .innerJoin(caseTypes, eq(caseTypes.id, productionCases.caseTypeId))
    .leftJoin(users, eq(users.id, productionCases.designerId))
    .where(eq(productionCases.id, id));
  if (!r || (!seesAllCases(v) && r.c.designerId !== v.id)) return null;
  return { ...r.c, code: caseCode(r.c.id), client: r.client, type: r.type, designer: r.designer };
}

/** May this person add or remove files on the case? Managers always; a designer only on their own open case. */
export async function canWorkOnCase(db: Db, caseId: number, v: Viewer) {
  if (!can(v.role, "production:work")) return false;
  const c = await load(db, caseId);
  if (!c) return false;
  if (can(v.role, "production:manage")) return true;
  return c.designerId === v.id && ["assigned", "designing"].includes(c.status);
}

/**
 * Per designer, over the cases delivered since `since` (and what is open now): load, first-time QC pass rate,
 * on-time rate, average turnaround in days, and pay earned.
 */
export async function designerStats(db: Db, since: Date) {
  const rows = await db.execute<{ id: number; name: string; open: number; delivered: number; first_pass: number; on_time: number; avg_days: number | null; pay: number }>(sql`
    select u.id, u.name,
      count(*) filter (where c.status in ('assigned', 'designing', 'qc'))::int as open,
      count(*) filter (where c.delivered_at >= ${since.toISOString()}::timestamptz)::int as delivered,
      count(*) filter (where c.delivered_at >= ${since.toISOString()}::timestamptz and c.qc_fails = 0)::int as first_pass,
      count(*) filter (where c.delivered_at >= ${since.toISOString()}::timestamptz and c.delivered_at <= c.due_at)::int as on_time,
      round(avg(extract(epoch from c.delivered_at - c.received_at) / 86400) filter (where c.delivered_at >= ${since.toISOString()}::timestamptz)::numeric, 1)::float as avg_days,
      coalesce(sum(c.designer_pay_egp) filter (where c.delivered_at >= ${since.toISOString()}::timestamptz), 0)::int as pay
    from production_cases c join users u on u.id = c.designer_id
    where c.status <> 'cancelled'
    group by u.id, u.name
    order by u.name`);
  return [...rows].map((r) => {
    const delivered = Number(r.delivered);
    return {
      id: Number(r.id),
      name: String(r.name),
      open: Number(r.open),
      delivered,
      firstPassRate: delivered ? Number(r.first_pass) / delivered : null,
      onTimeRate: delivered ? Number(r.on_time) / delivered : null,
      avgDays: r.avg_days == null ? null : Number(r.avg_days),
      pay: Number(r.pay),
    };
  });
}

/** For the Command centre: open cases, and those past their due time. */
export async function productionPulse(db: Db, now = new Date()) {
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${productionCases.status} in ('received', 'assigned', 'designing', 'qc'))::int`,
      late: sql<number>`count(*) filter (where ${productionCases.status} in ('received', 'assigned', 'designing', 'qc') and ${productionCases.dueAt} < ${now.toISOString()}::timestamptz)::int`,
      qc: sql<number>`count(*) filter (where ${productionCases.status} = 'qc' and ${productionCases.qcPassedAt} is null)::int`,
      unassigned: sql<number>`count(*) filter (where ${productionCases.status} = 'received')::int`,
      toInvoice: sql<number>`count(*) filter (where ${productionCases.status} = 'delivered')::int`,
    })
    .from(productionCases);
  return { open: Number(r.open), late: Number(r.late), qc: Number(r.qc), unassigned: Number(r.unassigned), toInvoice: Number(r.toInvoice) };
}
