export type Role = "owner" | "sales" | "viewer" | "finance";

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
  ]),
  sales: new Set<Action>(["lead:read", "lead:write", "task:write", "file:write"]),
  viewer: new Set<Action>(["lead:read"]),
  // Finance: sees everything, records/edits payments and exports revenue. No lead, settings or user edits.
  finance: new Set<Action>(["lead:read", "payment:write", "revenue:export", "finance:read", "task:write", "file:write"]),
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].has(action);
}
