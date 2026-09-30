export type Role = "owner" | "sales" | "viewer" | "finance";

export type Action =
  | "lead:read"
  | "lead:write" // create/edit leads, activities, follow-ups, consults, enrolments
  | "lead:delete"
  | "settings:write"
  | "users:manage"
  | "payment:write" // record payments and edit ledger rows, candidate plans and discounts
  | "revenue:export"
  | "audit:read"
  | "stage:override" // move a lead although the stage's exit criteria are not met (with a reason)
  | "finance:read"; // the Finance board: ledger, costs, partner shares (owner and finance only)

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>([
    "lead:read",
    "lead:write",
    "lead:delete",
    "settings:write",
    "users:manage",
    "payment:write",
    "revenue:export",
    "audit:read",
    "stage:override",
    "finance:read",
  ]),
  sales: new Set<Action>(["lead:read", "lead:write"]),
  viewer: new Set<Action>(["lead:read"]),
  // Finance: sees everything, records/edits payments and exports revenue. No lead, settings or user edits.
  finance: new Set<Action>(["lead:read", "payment:write", "revenue:export", "finance:read"]),
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].has(action);
}
