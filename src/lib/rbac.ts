export type Role = "owner" | "sales" | "viewer" | "finance" | "instructor" | "designer";

export type Action =
  | "lead:read"
  | "lead:write" // create/edit leads, activities, follow-ups, consults, enrolments
  | "lead:delete"
  | "lead:export" // download the lead list (names, phones, emails): owners only
  | "settings:write"
  | "users:manage"
  | "payment:write" // record payments and edit ledger rows, candidate plans and discounts
  | "revenue:export"
  | "audit:read"
  | "task:write" // create, assign and finish team tasks (everyone who works; viewers only read)
  | "file:write" // attach files to leads and batches (same people as tasks)
  | "growth:write" // campaigns, lead forms, masterclasses, content calendar, referrals (owner and sales)
  | "programme:write" // classes, attendance, assignments and reviews, graduation, alumni, portal invites (owner and instructor)
  | "production:read" // the production studio: cases and clients (designers see only the cases assigned to them)
  | "production:manage" // clients, the price list, taking cases in, assigning, QC review, delivery (owner)
  | "production:work" // work a case assigned to you: start it, add its files, send it to QC (owner and designer)
  | "ops:manage" // responsibilities, the SOP library, meetings and decisions (owner); running a checklist is task:write
  | "stage:override" // move a lead although the stage's exit criteria are not met (with a reason)
  | "finance:read"; // revenue anywhere (dashboard, batches, a lead's payments) and the Finance board: owner and finance only

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>([
    "lead:read",
    "lead:write",
    "lead:delete",
    "lead:export",
    "settings:write",
    "users:manage",
    "payment:write",
    "revenue:export",
    "audit:read",
    "stage:override",
    "finance:read",
    "task:write",
    "file:write",
    "growth:write",
    "programme:write",
    "production:read",
    "production:manage",
    "production:work",
    "ops:manage",
  ]),
  sales: new Set<Action>(["lead:read", "lead:write", "task:write", "file:write", "growth:write"]),
  viewer: new Set<Action>(["lead:read"]),
  // Finance: sees everything, records/edits payments and exports revenue. No lead, settings or user edits.
  finance: new Set<Action>(["lead:read", "payment:write", "revenue:export", "finance:read", "task:write", "file:write", "production:read"]),
  // Instructor: teaches and reviews. Reads students' lead pages, runs classes, attendance, reviews and graduation; no money.
  instructor: new Set<Action>(["lead:read", "task:write", "file:write", "programme:write"]),
  // Designer: often a Production Partner graduate. Only the production studio, and only the cases assigned to them:
  // no leads, no students, no money other than their own pay per case.
  designer: new Set<Action>(["production:read", "production:work"]),
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].has(action);
}
