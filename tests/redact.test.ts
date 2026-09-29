import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { isForeignKeyViolation, isUniqueViolation, pgCode } from "@/lib/db-errors";
import { installLogScrubber, scrubError } from "@/lib/redact";

// What the real stack produces for a duplicate phone: a Drizzle error wrapping a postgres-js error that
// carries the values in several places.
function realisticDbError() {
  const driver = Object.assign(new Error('duplicate key value violates unique constraint "leads_phone_whatsapp_unique"'), {
    name: "PostgresError",
    code: "23505",
    detail: "Key (phone_whatsapp)=(+201001234567) already exists.",
    constraint_name: "leads_phone_whatsapp_unique",
    table_name: "leads",
    query: 'insert into "leads" ("full_name","phone_whatsapp") values ($1,$2)',
    parameters: ["د. محمد علي", "+201001234567"],
    args: ["د. محمد علي", "+201001234567"],
  });
  const wrapped = new Error('Failed query: insert into "leads" ("full_name","phone_whatsapp") values ($1,$2)\nparams: د. محمد علي,+201001234567', { cause: driver });
  wrapped.name = "DrizzleQueryError";
  return Object.assign(wrapped, { digest: "1234567890" });
}
const SECRETS = ["+201001234567", "1001234567", "محمد", "Key (phone_whatsapp)"];

describe("Postgres error codes through Drizzle's wrapper", () => {
  it("finds the SQLSTATE on the wrapped cause", () => {
    const e = realisticDbError();
    expect(pgCode(e)).toBe("23505");
    expect(isUniqueViolation(e)).toBe(true);
    expect(isForeignKeyViolation(e)).toBe(false);
  });
  it("works on an unwrapped driver error and ignores everything else", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isForeignKeyViolation({ cause: { code: "23503" } })).toBe(true);
    expect(pgCode(new Error("plain"))).toBeUndefined();
    expect(pgCode({ code: "ECONNREFUSED" })).toBeUndefined(); // Node error codes are not SQLSTATEs
    expect(pgCode(null)).toBeUndefined();
    expect(pgCode("string")).toBeUndefined();
  });
});

describe("scrubbing errors before they are logged", () => {
  it("removes parameters, values and constraint detail from every level, however the error is printed", () => {
    const safe = scrubError(realisticDbError());
    for (const printed of [inspect(safe, { depth: 10 }), JSON.stringify(safe, Object.getOwnPropertyNames(safe as object)), String((safe as Error).stack), String(safe)]) {
      for (const secret of SECRETS) expect(printed, `leaked ${secret}`).not.toContain(secret);
    }
    expect(inspect(realisticDbError(), { depth: 10 })).toContain("+201001234567"); // sanity: the raw error really does leak
  });

  it("keeps what is needed to debug: name, sql shape, SQLSTATE, constraint, table and the request digest", () => {
    const safe = scrubError(realisticDbError()) as Error & { digest?: string; cause?: Error };
    expect(safe.name).toBe("DrizzleQueryError");
    expect(safe.message).toContain('Failed query: insert into "leads"');
    expect(safe.digest).toBe("1234567890");
    expect(safe.cause?.message).toContain("pg 23505");
    expect(safe.cause?.message).toContain("leads_phone_whatsapp_unique");
    expect(safe.cause?.message).toContain("on leads");
  });

  it("passes non-errors and ordinary errors through unharmed", () => {
    expect(scrubError("text")).toBe("text");
    expect(scrubError(42)).toBe(42);
    expect(scrubError(undefined)).toBeUndefined();
    const plain = scrubError(new TypeError("x is not a function")) as Error;
    expect(plain.name).toBe("TypeError");
    expect(plain.message).toBe("x is not a function");
  });

  it("handles a cause loop without hanging", () => {
    const a = new Error("a");
    (a as Error & { cause?: unknown }).cause = a;
    expect(() => scrubError(a)).not.toThrow();
  });

  it("console.error is scrubbed once installed, including errors nested in other arguments' cause", () => {
    const seen: unknown[][] = [];
    const fake = { error: (...a: unknown[]) => void seen.push(a) } as unknown as Console;
    installLogScrubber(fake);
    fake.error("request failed:", realisticDbError(), { note: "plain object" });
    const printed = inspect(seen, { depth: 12 });
    for (const secret of SECRETS) expect(printed).not.toContain(secret);
    expect(printed).toContain("request failed:");
    expect(printed).toContain("plain object");
  });

  it("the instrumentation hook installs the scrubber on the real console for the Node runtime only", async () => {
    const original = console.error;
    const spy = vi.fn();
    console.error = spy;
    try {
      vi.stubEnv("NEXT_RUNTIME", "edge");
      const { register } = await import("@/instrumentation");
      await register();
      expect(console.error).toBe(spy); // untouched on edge
      vi.stubEnv("NEXT_RUNTIME", "nodejs");
      await register();
      console.error(realisticDbError());
      expect(inspect(spy.mock.calls, { depth: 12 })).not.toContain("+201001234567");
    } finally {
      console.error = original;
      vi.unstubAllEnvs();
    }
  });
});
