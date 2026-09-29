// Postgres error handling. The driver's error message for a constraint violation includes the offending
// VALUES ("Key (phone_whatsapp)=(+2010...) already exists"), which must never reach logs or the UI.

export function pgCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export const isUniqueViolation = (e: unknown) => pgCode(e) === "23505";
export const isForeignKeyViolation = (e: unknown) => pgCode(e) === "23503";
