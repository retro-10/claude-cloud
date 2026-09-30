// Postgres error handling. The driver's error for a constraint violation carries the offending VALUES
// ("Key (phone_whatsapp)=(+2010...) already exists") and the query parameters, which must never reach
// logs or the UI. Drizzle wraps the driver error, so the SQLSTATE code is on `cause`, not on the error.

export function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export const isUniqueViolation = (e: unknown) => pgCode(e) === "23505";
export const isForeignKeyViolation = (e: unknown) => pgCode(e) === "23503";
