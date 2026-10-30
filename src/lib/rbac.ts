export type Role = "owner" | "sales" | "viewer" | "finance" | "instructor" | "designer" | "marketing";

export type Action =
  | "hq:read" // HQ home, inbox, docs, spaces, tasks, team & ops: everyone except designers
  | "growth:read" // campaigns, content, forms, masterclasses, referrals (lead names inside them need lead:read)
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
  | "calendar:write" // clock in and out, and plan your own calendar (everyone); owners also fix anyone's
  | "chat:write" // team chat: channels and direct messages (everyone)
  | "comms:read" // announcements and the team directory (everyone)
  | "comms:post" // post, pin and archive announcements (owner)
  | "brand:read" // the brand hub: guidelines and the asset library (everyone)
  | "brand:manage" // add assets, new versions, retire them, edit brand guideline pages (owner, marketing)
  | "approval:submit" // ask for an approval (expense, purchase, leave …) and follow it; deciding depends on the routing rules
  | "employee:self" // my employee portal: own profile, terms, documents, requests and pay (every staff role; two-factor required)
  | "employee:pay" // everyone's pay terms, nothing else of their records (finance)
  | "employee:manage" // everyone's employee records and documents, every view logged (owner)
  | "ai:use" // Ask OrlaDent and AI drafts, when an owner has switched the assistant on (not designers)
  | "finance:read"; // revenue anywhere (dashboard, batches, a lead's payments) and the Finance board: owner and finance only

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>([
    "hq:read",
    "growth:read",
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
    "ai:use",
    "calendar:write",
    "chat:write",
    "approval:submit",
    "comms:read",
    "comms:post",
    "brand:read",
    "brand:manage",
    "employee:self",
    "employee:pay",
    "employee:manage",
  ]),
  sales: new Set<Action>(["hq:read", "growth:read", "lead:read", "lead:write", "task:write", "file:write", "growth:write", "ai:use", "calendar:write", "chat:write", "approval:submit", "comms:read", "brand:read", "employee:self"]),
  viewer: new Set<Action>(["hq:read", "growth:read", "lead:read", "ai:use", "calendar:write", "chat:write", "approval:submit", "comms:read", "brand:read", "employee:self"]),
  // Finance: sees everything, records/edits payments and exports revenue. No lead, settings or user edits.
  finance: new Set<Action>(["hq:read", "growth:read", "lead:read", "payment:write", "revenue:export", "finance:read", "task:write", "file:write", "production:read", "ai:use", "calendar:write", "chat:write", "approval:submit", "comms:read", "brand:read", "employee:self", "employee:pay"]),
  // Instructor: teaches and reviews. Reads students' lead pages, runs classes, attendance, reviews and graduation; no money.
  instructor: new Set<Action>(["hq:read", "growth:read", "lead:read", "task:write", "file:write", "programme:write", "ai:use", "calendar:write", "chat:write", "approval:submit", "comms:read", "brand:read", "employee:self"]),
  // Designer: often a Production Partner graduate. Only the production studio, and only the cases assigned to them:
  // no leads, no students, no money other than their own pay per case.
  designer: new Set<Action>(["production:read", "production:work", "calendar:write", "chat:write", "approval:submit", "comms:read", "brand:read", "employee:self"]),
  // Marketing: plans campaigns, content and masterclasses, and works in HQ. No lead records (names, phones): growth
  // pages show them only to people with lead:read, and the AI assistant reads leads only for those roles.
  marketing: new Set<Action>(["hq:read", "growth:read", "growth:write", "task:write", "ai:use", "calendar:write", "chat:write", "approval:submit", "comms:read", "brand:read", "brand:manage", "employee:self"]),
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].has(action);
}
