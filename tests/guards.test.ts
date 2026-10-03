import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Static guards: fail the build if someone adds a server action or route handler and forgets the
// server-side permission check. The UI hiding a button is never enough; the server must refuse.
const ROOT = join(__dirname, "..", "src");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = walk(ROOT);
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

// exported functions that are deliberately public (before a session exists)
// verify2fa runs before there is a session: the signed 5-minute pass from the password step is its check.
// submitFormAction is the public sign-up form: its checks are the honeypot, the signed stamp and the rate limit.
// portalLogin and acceptInviteAction are the student portal's way in: rate limits, and the one-time token.
const PUBLIC_ACTIONS = new Set([
  "app/login/actions.ts:login",
  "app/login/actions.ts:logout",
  "app/login/actions.ts:verify2fa",
  "app/f/[slug]/actions.ts:submitFormAction",
  "app/portal/actions.ts:portalLogin",
  "app/portal/actions.ts:acceptInviteAction",
  "app/portal/actions.ts:portalLogout",
]);
// student portal actions check the student's own session, not a staff permission
const isPortal = (f: string) => rel(f).startsWith("app/portal/");
// the inbound webhook has no session: its check is the bearer token (asserted below)
const PUBLIC_ROUTES = new Set(["app/api/health/route.ts", "app/api/inbound/leads/route.ts"]);

function exportedAsyncFunctions(src: string): { name: string; body: string }[] {
  const parts = src.split(/^export async function /m).slice(1);
  return parts.map((p) => ({ name: p.slice(0, p.indexOf("(")).trim(), body: p }));
}

describe("every server action checks the caller on the server", () => {
  const actionFiles = files.filter((f) => /[\\/]actions\.ts$/.test(f) && readFileSync(f, "utf8").startsWith('"use server"'));

  it("finds the action files (guard against the scan silently matching nothing)", () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const f of actionFiles) {
    it(`${rel(f)}: each exported action calls requireCan or requireUser`, () => {
      const fns = exportedAsyncFunctions(readFileSync(f, "utf8"));
      expect(fns.length).toBeGreaterThan(0);
      for (const fn of fns) {
        if (PUBLIC_ACTIONS.has(`${rel(f)}:${fn.name}`)) continue;
        const check = isPortal(f) ? /requireStudent\(/ : /requireCan\(|requireUser\(/;
        expect(check.test(fn.body), `${rel(f)}: ${fn.name} has no permission check`).toBe(true);
      }
    });
  }

  it("write actions use requireCan with an explicit permission, not just a sign-in check", () => {
    // requireUser alone is only right for read-only or self-service actions
    const selfService = new Set([
      "changePasswordAction",
      "markNotificationsReadAction",
      // your own two-factor: every user, any role
      "startTwoFactorAction",
      "confirmTwoFactorAction",
      "newRecoveryCodesAction",
      "disableTwoFactorAction",
    ]);
    for (const f of actionFiles) {
      for (const fn of exportedAsyncFunctions(readFileSync(f, "utf8"))) {
        if (PUBLIC_ACTIONS.has(`${rel(f)}:${fn.name}`) || selfService.has(fn.name) || isPortal(f)) continue;
        expect(/requireCan\(/.test(fn.body), `${rel(f)}: ${fn.name} should use requireCan(<permission>)`).toBe(true);
      }
    }
  });
});

describe("every route handler checks the caller", () => {
  const routes = files.filter((f) => /[\\/]route\.ts$/.test(f));
  it("finds the route handlers", () => expect(routes.length).toBeGreaterThanOrEqual(3));
  for (const f of routes) {
    it(`${rel(f)} is either explicitly public or checks the session and a permission`, () => {
      if (PUBLIC_ROUTES.has(rel(f))) return;
      const src = readFileSync(f, "utf8");
      expect(src).toContain("getCurrentUser(");
      expect(src).toMatch(/can\(user\.role, "[a-z]+:[a-z]+"\)/);
    });
  }
});

describe("the inbound lead webhook", () => {
  it("is off without a token and compares the token in constant time before doing anything", () => {
    const src = readFileSync(files.find((f) => /api[\\/]inbound[\\/]leads[\\/]route\.ts$/.test(f))!, "utf8");
    const check = src.indexOf("timingSafeEqual(");
    expect(src).toContain("process.env.INBOUND_LEADS_TOKEN");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(src.indexOf("req.json()"));
  });
});

describe("settings pages enforce their own permission (a layout check alone can be skipped by parallel rendering)", () => {
  const pages = files.filter((f) => /app[\\/]\(app\)[\\/]settings[\\/].*page\.tsx$/.test(f) && !/settings[\\/]page\.tsx$/.test(f));
  it("finds the settings pages", () => expect(pages.length).toBeGreaterThanOrEqual(5));
  for (const f of pages) {
    it(`${rel(f)} calls requirePageCan`, () => expect(readFileSync(f, "utf8")).toMatch(/requirePageCan\("(settings:write|users:manage|audit:read)"\)/));
  }
});

describe("every staff page names the permission it needs", () => {
  // Not every role may read leads (designers see only the production studio), so a sign-in check is not enough.
  // Exceptions: your own account; Today, which sends people without the lead list elsewhere; the settings index
  // (a redirect; the settings layout and pages check settings:write).
  const OPEN = new Set(["app/(app)/account/page.tsx", "app/(app)/settings/page.tsx"]);
  const pages = files.filter((f) => /app[\\/]\(app\)[\\/].*page\.tsx$/.test(f));
  it("finds the staff pages", () => expect(pages.length).toBeGreaterThanOrEqual(40));
  for (const f of pages) {
    if (OPEN.has(rel(f))) continue;
    it(`${rel(f)} calls requirePageCan (or checks lead:read itself)`, () => {
      const src = readFileSync(f, "utf8");
      if (rel(f) === "app/(app)/page.tsx") return expect(src).toMatch(/if \(!can\(user\.role, "lead:read"\)\) redirect\(/);
      expect(src).toMatch(/requirePageCan\("[a-z]+:[a-z]+"\)/);
    });
  }
});

describe("print pages outside the app shell check the user themselves", () => {
  it("invoices and receipts: signed in, and allowed to see the money", () => {
    const pages = files.filter((f) => /app[\\/](invoices|receipts)[\\/].*page\.tsx$/.test(f));
    expect(pages.length).toBe(2);
    for (const f of pages) {
      const src = readFileSync(f, "utf8");
      expect(src, rel(f)).toContain("getCurrentUser(");
      expect(src, rel(f)).toMatch(/if \(!can\(user\.role, "finance:read"\)\) notFound\(\)/);
    }
  });
});

describe("no secrets or personal data in logs", () => {
  it("source never logs with console.*", () => {
    const offenders = files.filter((f) => /\.(ts|tsx)$/.test(f) && !/db[\\/](seed|migrate)\.ts$/.test(f) && /console\.(log|error|warn|info)\(/.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the audit helper is never given lead values (no fullName/phone/email/notes/body in a diff)", () => {
    for (const f of files.filter((f) => /\.(ts|tsx)$/.test(f))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/audit\([^;]*?diff:\s*\{([^}]*)\}/gs)) {
        expect(m[1], `${rel(f)}: audit diff contains personal data`).not.toMatch(/\b(fullName|phone|phoneWhatsapp|email|notes|body|password)\b\s*[:,}]/);
      }
    }
  });
});

describe("the student portal", () => {
  it("every portal page checks the student session (sign-in and invite pages aside)", () => {
    const pages = files.filter((f) => /app[\\/]portal[\\/].*page\.tsx$/.test(f) && !/portal[\\/](login|invite)[\\/]/.test(f));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const f of pages) expect(readFileSync(f, "utf8"), rel(f)).toContain("requireStudent(");
  });
  it("staff code never trusts the student cookie, and portal code never reads the staff one", () => {
    for (const f of files.filter((x) => !rel(x).startsWith("app/portal/") && !/lib[\\/](session|student-auth)\.ts$/.test(x))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/STUDENT_COOKIE|verifyStudent\(/);
    }
    for (const f of files.filter((x) => rel(x).startsWith("app/portal/"))) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/SESSION_COOKIE|requireUser\(|requireCan\(/);
  });
});
