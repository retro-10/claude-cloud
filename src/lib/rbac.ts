export type Role = "owner" | "sales" | "viewer" | "finance";

export type Action =
  | "lead:read"
  | "lead:write" // create/edit leads, activities, follow-ups, consults, enrolments
  | "lead:delete"
  | "settings:write"
  | "users:manage"
  | "audit:read";

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>([
    "lead:read",
    "lead:write",
    "lead:delete",
    "settings:write",
    "users:manage",
    "audit:read",
  ]),
  sales: new Set<Action>(["lead:read", "lead:write"]),
  viewer: new Set<Action>(["lead:read"]),
  // Placeholder until the finance permissions are defined (QUESTIONS.md #1): read-only, like viewer.
  finance: new Set<Action>(["lead:read"]),
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].has(action);
}
