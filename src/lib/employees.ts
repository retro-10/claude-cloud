import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { attachments, employeeChangeRequests, employeeDocuments, employees, ledgerEntries, notifications, teamMembers, users } from "@/db/schema";
import { addAttachment, fileProblem, listAttachments } from "./attachments";
import { audit } from "./audit";
import type { Role } from "./rbac";
import type { Fail } from "./result";

// The employee portal (HQ brief section 13): each person's profile, terms, contract documents and pay, visible to
// them; owners see everyone's (each view logged); finance sees pay terms only. Two-factor sign-in is required to
// open any of it (checked by the pages and actions). Nothing here is sent to Notion, the AI assistant or the exports,
// and the audit log records which fields changed, never their values.

export const WORKER_TYPES = { employee: "Employee", partner: "Partner", contractor: "Contractor" } as const;
export type WorkerType = keyof typeof WORKER_TYPES;

export const DOC_CATEGORIES = {
  contract: "Contract",
  addendum: "Addendum",
  offer_letter: "Offer letter",
  policy: "Policy",
  identity: "Identity document",
  other: "Other",
} as const;
export type DocCategory = keyof typeof DOC_CATEGORIES;

/** What the person edits themselves. */
export const CONTACT_FIELDS = {
  phone: "Phone",
  personalEmail: "Personal email",
  address: "Address",
  emergencyName: "Emergency contact",
  emergencyPhone: "Emergency contact's phone",
} as const;
export type ContactField = keyof typeof CONTACT_FIELDS;

/** What only an owner changes; the person asks for a change. */
export const SENSITIVE_FIELDS = {
  name: "Name",
  jobTitle: "Job title",
  workerType: "Worker type",
  startDate: "Start date",
  managerId: "Manager",
  payTerms: "Pay terms",
  payAmountEgp: "Pay (EGP)",
  paySchedule: "Pay schedule",
  noticePeriod: "Notice period",
} as const;
export type SensitiveField = keyof typeof SENSITIVE_FIELDS;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export type Employee = typeof employees.$inferSelect;
const blank = (userId: number): Employee => ({
  userId,
  workerType: "employee",
  jobTitle: null,
  startDate: null,
  endDate: null,
  managerId: null,
  phone: null,
  personalEmail: null,
  address: null,
  emergencyName: null,
  emergencyPhone: null,
  payTerms: null,
  payAmountEgp: null,
  paySchedule: null,
  noticePeriod: null,
  teamMemberId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

/** The record (a blank one until an owner fills it in), with the person's name, role and manager. */
export async function getEmployee(db: Db, userId: number) {
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active }).from(users).where(eq(users.id, userId));
  if (!u) return null;
  const [e] = await db.select().from(employees).where(eq(employees.userId, userId));
  const rec = e ?? blank(userId);
  const [m] = rec.managerId ? await db.select({ name: users.name }).from(users).where(eq(users.id, rec.managerId)) : [];
  return { ...rec, exists: !!e, user: u, manager: m?.name ?? null };
}

async function upsert(db: Db, userId: number, values: Partial<Employee>) {
  await db
    .insert(employees)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: employees.userId, set: { ...values, updatedAt: new Date() } });
}

/** The person updates their own contact details. */
export async function updateContact(db: Db, userId: number, input: Partial<Record<ContactField, string | null>>): Promise<{ ok: true } | Fail> {
  const values: Partial<Employee> = {};
  for (const k of Object.keys(CONTACT_FIELDS) as ContactField[]) if (k in input) values[k] = text(input[k], k === "address" ? 400 : 200);
  if (values.personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.personalEmail)) return { ok: false, error: "That email does not look right" };
  await upsert(db, userId, values);
  await audit(db, { userId, entity: "employee", entityId: userId, action: "contact", diff: { fields: Object.keys(values) } });
  return { ok: true };
}

export type EmployeeInput = {
  workerType: string;
  jobTitle?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  managerId?: number | null;
  payTerms?: string | null;
  payAmountEgp?: number | null;
  paySchedule?: string | null;
  noticePeriod?: string | null;
  teamMemberId?: number | null;
};

/** An owner fills in or edits the record (everything but the person's contact details). */
export async function saveEmployee(db: Db, ownerId: number, userId: number, input: EmployeeInput): Promise<{ ok: true } | Fail> {
  if (!(input.workerType in WORKER_TYPES)) return { ok: false, error: "Pick the worker type" };
  for (const d of [input.startDate, input.endDate]) if (d && !YMD.test(d)) return { ok: false, error: "Dates are YYYY-MM-DD" };
  if (input.startDate && input.endDate && input.endDate < input.startDate) return { ok: false, error: "The end date is before the start" };
  if (input.payAmountEgp != null && (!Number.isInteger(input.payAmountEgp) || input.payAmountEgp < 0)) return { ok: false, error: "Pay is a whole number of EGP" };
  if (input.managerId === userId) return { ok: false, error: "Someone cannot be their own manager" };
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!u) return { ok: false, error: "That person does not exist" };
  const before = await getEmployee(db, userId);
  const values = {
    workerType: input.workerType as WorkerType,
    jobTitle: text(input.jobTitle),
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    managerId: input.managerId ?? null,
    payTerms: text(input.payTerms, 400),
    payAmountEgp: input.payAmountEgp ?? null,
    paySchedule: text(input.paySchedule),
    noticePeriod: text(input.noticePeriod),
    teamMemberId: input.teamMemberId ?? null,
  };
  await upsert(db, userId, values);
  const changed = (Object.keys(values) as (keyof typeof values)[]).filter((k) => before?.[k] !== values[k]);
  await audit(db, { userId: ownerId, entity: "employee", entityId: userId, action: before?.exists ? "update" : "create", diff: { fields: changed } });
  return { ok: true };
}

// ---------------- change requests ----------------

export async function requestChange(db: Db, me: { id: number; name: string }, field: string, value: string, reason?: string | null): Promise<{ ok: true } | Fail> {
  if (!(field in SENSITIVE_FIELDS)) return { ok: false, error: "Pick what should change" };
  const v = value.trim().slice(0, 400);
  if (!v) return { ok: false, error: "Say what it should be" };
  const [open] = await db
    .select({ id: employeeChangeRequests.id })
    .from(employeeChangeRequests)
    .where(and(eq(employeeChangeRequests.userId, me.id), eq(employeeChangeRequests.field, field), eq(employeeChangeRequests.status, "pending")));
  if (open) return { ok: false, error: "You already asked for that; it is waiting for an owner" };
  const [row] = await db.insert(employeeChangeRequests).values({ userId: me.id, field, value: v, reason: text(reason, 1000) }).returning({ id: employeeChangeRequests.id });
  const owners = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "owner"), eq(users.active, true), ne(users.id, me.id)));
  if (owners.length)
    await db.insert(notifications).values(owners.map((o) => ({ userId: o.id, kind: "employee_change", title: `${me.name} asks to change their ${SENSITIVE_FIELDS[field as SensitiveField].toLowerCase()}`, link: `/employees/${me.id}` })));
  await audit(db, { userId: me.id, entity: "employee_change", entityId: row.id, action: "request", diff: { field } });
  return { ok: true };
}

/** An owner applies a requested change (writing the field) or declines it with a note. Nobody decides their own. */
export async function decideChange(db: Db, owner: { id: number; name: string }, id: number, apply: boolean, note?: string | null): Promise<{ ok: true } | Fail> {
  const [r] = await db.select().from(employeeChangeRequests).where(eq(employeeChangeRequests.id, id));
  if (!r || r.status !== "pending") return { ok: false, error: "That request is not waiting" };
  if (r.userId === owner.id) return { ok: false, error: "Another owner decides changes to your own record" };
  if (!apply && !note?.trim()) return { ok: false, error: "Say why it is declined" };
  if (apply) {
    const field = r.field as SensitiveField;
    if (field === "name") {
      await db.update(users).set({ name: r.value.slice(0, 120) }).where(eq(users.id, r.userId));
    } else if (field === "payAmountEgp") {
      const n = Number(r.value.replace(/[,\s]/g, ""));
      if (!Number.isInteger(n) || n < 0) return { ok: false, error: "The requested pay is not a whole number: edit the record by hand instead" };
      await upsert(db, r.userId, { payAmountEgp: n });
    } else if (field === "workerType") {
      if (!(r.value in WORKER_TYPES)) return { ok: false, error: "Not a worker type: edit the record by hand instead" };
      await upsert(db, r.userId, { workerType: r.value as WorkerType });
    } else if (field === "startDate") {
      if (!YMD.test(r.value)) return { ok: false, error: "Not a YYYY-MM-DD date: edit the record by hand instead" };
      await upsert(db, r.userId, { startDate: r.value });
    } else if (field === "managerId") {
      return { ok: false, error: "Pick the manager on the record itself, then decline this with a note" };
    } else {
      await upsert(db, r.userId, { [field]: r.value.slice(0, 400) });
    }
  }
  await db
    .update(employeeChangeRequests)
    .set({ status: apply ? "applied" : "declined", decidedBy: owner.id, decidedAt: new Date(), note: text(note, 1000) })
    .where(eq(employeeChangeRequests.id, id));
  await db.insert(notifications).values({
    userId: r.userId,
    kind: "employee_change",
    title: `${owner.name} ${apply ? "made" : "declined"} the change to your ${SENSITIVE_FIELDS[r.field as SensitiveField]?.toLowerCase() ?? r.field}`,
    link: "/me#requests",
  });
  await audit(db, { userId: owner.id, entity: "employee_change", entityId: id, action: apply ? "apply" : "decline", diff: { field: r.field } });
  return { ok: true };
}

export const changeRequests = (db: Db, f: { userId?: number; pending?: boolean }) =>
  db
    .select({ r: employeeChangeRequests, name: users.name })
    .from(employeeChangeRequests)
    .innerJoin(users, eq(users.id, employeeChangeRequests.userId))
    .where(and(f.userId ? eq(employeeChangeRequests.userId, f.userId) : undefined, f.pending ? eq(employeeChangeRequests.status, "pending") : undefined))
    .orderBy(desc(employeeChangeRequests.createdAt))
    .limit(100);

// ---------------- documents ----------------

type FileIn = { name: string; bytes: Buffer };

/** An owner adds a document for someone; they are asked to read it (and acknowledge it, if it needs that). */
export async function addDocument(
  db: Db,
  ownerId: number,
  userId: number,
  input: { category: string; title: string; needsAck?: boolean },
  file: FileIn | null,
  replaces?: typeof employeeDocuments.$inferSelect,
): Promise<{ ok: true; id: number } | Fail> {
  if (!(input.category in DOC_CATEGORIES)) return { ok: false, error: "Pick the kind of document" };
  const title = input.title.trim().slice(0, 160);
  if (!title) return { ok: false, error: "Give the document a title" };
  if (!file) return { ok: false, error: "Add the file" };
  const bad = fileProblem(file);
  if (bad) return { ok: false, error: bad };
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!u) return { ok: false, error: "That person does not exist" };
  const needsAck = input.needsAck ?? input.category !== "identity";
  const [row] = await db
    .insert(employeeDocuments)
    .values({ userId, category: input.category, title, needsAck, version: replaces ? replaces.version + 1 : 1, replacesId: replaces?.id ?? null, uploadedBy: ownerId })
    .returning({ id: employeeDocuments.id });
  const up = await addAttachment(db, file, { employeeDocumentId: row.id }, ownerId);
  if (!up.ok) {
    await db.delete(employeeDocuments).where(eq(employeeDocuments.id, row.id));
    return up;
  }
  if (replaces) await db.update(employeeDocuments).set({ status: "superseded" }).where(eq(employeeDocuments.id, replaces.id));
  if (userId !== ownerId)
    await db.insert(notifications).values({
      userId,
      kind: "employee_document",
      title: `${needsAck ? "Please read and accept" : "New document"}: ${title}${replaces ? ` (version ${replaces.version + 1})` : ""}`,
      link: `/me/documents/${row.id}`,
    });
  await audit(db, { userId: ownerId, entity: "employee_document", entityId: row.id, action: replaces ? "new_version" : "add", diff: { userId, category: input.category } });
  return { ok: true, id: row.id };
}

/** A new version of a current document: the old one stays visible, marked superseded. */
export async function newDocumentVersion(db: Db, ownerId: number, id: number, file: FileIn | null): Promise<{ ok: true; id: number } | Fail> {
  const [old] = await db.select().from(employeeDocuments).where(eq(employeeDocuments.id, id));
  if (!old) return { ok: false, error: "That document does not exist" };
  if (old.status !== "current") return { ok: false, error: "Only the current version can be replaced" };
  return addDocument(db, ownerId, old.userId, { category: old.category, title: old.title, needsAck: old.needsAck }, file, old);
}

export async function documentsFor(db: Db, userId: number) {
  // named in full: in a one-table select drizzle writes the outer id unqualified (it would mean the attachment's own)
  const fileId = sql<number | null>`(select a.id from ${attachments} a where a.employee_document_id = ${sql.raw(`"employee_documents"."id"`)} and a.deleted_at is null order by a.id desc limit 1)`;
  const rows = await db
    .select({ d: employeeDocuments, fileId })
    .from(employeeDocuments)
    .where(eq(employeeDocuments.userId, userId))
    .orderBy(asc(employeeDocuments.title), desc(employeeDocuments.version));
  return rows.map((r) => ({ ...r.d, fileId: r.fileId }));
}

/** One document with its file, for its owner-person or an owner; null for anyone else. */
export async function getDocument(db: Db, id: number, viewer: { id: number; role: Role; manage: boolean }) {
  const [d] = await db.select().from(employeeDocuments).where(eq(employeeDocuments.id, id));
  if (!d || (d.userId !== viewer.id && !viewer.manage)) return null;
  const [file] = await listAttachments(db, { employeeDocumentId: id });
  const history = await db.select().from(employeeDocuments).where(and(eq(employeeDocuments.userId, d.userId), eq(employeeDocuments.title, d.title))).orderBy(desc(employeeDocuments.version));
  return { ...d, file: file ?? null, history };
}

/** "I have read and accept": the person, once, on the current version of a document that asks for it. */
export async function acknowledgeDocument(db: Db, userId: number, id: number): Promise<{ ok: true } | Fail> {
  const done = await db
    .update(employeeDocuments)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(employeeDocuments.id, id), eq(employeeDocuments.userId, userId), eq(employeeDocuments.needsAck, true), eq(employeeDocuments.status, "current"), isNull(employeeDocuments.acknowledgedAt)))
    .returning({ version: employeeDocuments.version });
  if (!done.length) return { ok: false, error: "Nothing to accept here: it is accepted already, replaced, or not yours" };
  await audit(db, { userId, entity: "employee_document", entityId: id, action: "acknowledge", diff: { version: done[0].version } });
  return { ok: true };
}

export async function unacknowledgedCount(db: Db, userId: number) {
  const rows = await db
    .select({ id: employeeDocuments.id })
    .from(employeeDocuments)
    .where(and(eq(employeeDocuments.userId, userId), eq(employeeDocuments.needsAck, true), eq(employeeDocuments.status, "current"), isNull(employeeDocuments.acknowledgedAt)));
  return rows.length;
}

// ---------------- pay and lists ----------------

/** My pay: the ledger's cost rows for the team member linked to my record (nothing until an owner links one). */
export async function myPay(db: Db, userId: number, limit = 50) {
  const [e] = await db.select({ teamMemberId: employees.teamMemberId }).from(employees).where(eq(employees.userId, userId));
  if (!e?.teamMemberId) return null;
  return db
    .select({ id: ledgerEntries.id, entry: ledgerEntries.entry, amountEgp: ledgerEntries.amountEgp, status: ledgerEntries.status, date: ledgerEntries.date, createdAt: ledgerEntries.createdAt, category: ledgerEntries.category })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.teamMemberId, e.teamMemberId), isNull(ledgerEntries.deletedAt), inArray(ledgerEntries.section, ["fixed_costs", "variable_costs"])))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(limit);
}

/** Everyone, for owners (whole records) or finance (pay terms only: no contact, dates, manager or documents). */
export async function listEmployees(db: Db, scope: "full" | "pay") {
  const rows = await db
    .select({ u: { id: users.id, name: users.name, role: users.role, active: users.active }, e: employees })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .orderBy(desc(users.active), asc(users.name));
  return rows.map(({ u, e }) => {
    const pay = { payTerms: e?.payTerms ?? null, payAmountEgp: e?.payAmountEgp ?? null, paySchedule: e?.paySchedule ?? null };
    return scope === "pay"
      ? { ...u, workerType: e?.workerType ?? null, ...pay }
      : { ...u, workerType: e?.workerType ?? null, jobTitle: e?.jobTitle ?? null, startDate: e?.startDate ?? null, endDate: e?.endDate ?? null, hasRecord: !!e, ...pay };
  });
}

export const teamMemberOptions = (db: Db) => db.select({ id: teamMembers.id, name: teamMembers.name }).from(teamMembers).orderBy(asc(teamMembers.name));

/** Owners opening someone else's record: logged every time, as the brief asks. */
export async function logRecordView(db: Db, viewerId: number, userId: number) {
  if (viewerId !== userId) await audit(db, { userId: viewerId, entity: "employee", entityId: userId, action: "view" });
}
