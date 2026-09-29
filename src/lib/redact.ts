// Turns an error into a copy that is safe to write to a log: no query parameters, no constraint
// detail ("Key (phone)=(+20...)"), none of the driver's extra fields. It keeps what is needed to debug:
// the error name, the message without parameters, the Postgres code / constraint / table, the stack and
// the Next.js `digest` that ties a log line to what a user saw.

const MAX_DEPTH = 5;

export function scrubError(e: unknown, depth = 0): unknown {
  if (!(e instanceof Error) || depth > MAX_DEPTH) return e;
  const src = e as Error & { code?: unknown; constraint_name?: unknown; table_name?: unknown; digest?: unknown; cause?: unknown };

  // drizzle appends "\nparams: <values>" to its message
  const message = String(src.message).split("\nparams:")[0];
  const bits = [
    typeof src.code === "string" ? `pg ${src.code}` : "",
    typeof src.constraint_name === "string" ? src.constraint_name : "",
    typeof src.table_name === "string" ? `on ${src.table_name}` : "",
  ].filter(Boolean);

  const safe = new Error(bits.length ? `${message} [${bits.join(" ")}]` : message);
  safe.name = src.name;
  safe.stack = (src.stack ?? "").split("\nparams:")[0].replace(String(src.message), safe.message);
  if (typeof src.digest === "string") (safe as Error & { digest?: string }).digest = src.digest;
  if (src.cause !== undefined) (safe as Error & { cause?: unknown }).cause = scrubError(src.cause, depth + 1);
  return safe;
}

/** console.error with every Error argument scrubbed first. */
export function installLogScrubber(target: Console = console) {
  const original = target.error.bind(target);
  target.error = (...args: unknown[]) => original(...args.map((a) => scrubError(a)));
}
