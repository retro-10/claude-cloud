// In-memory sliding-window limiter. Fine for a single app instance (our deployment model).
// If the app is ever scaled horizontally, move this to Postgres or Redis.
const hits = new Map<string, number[]>();

const recent = (key: string, windowMs: number, now: number) => (hits.get(key) ?? []).filter((t) => now - t < windowMs);

/** Is `key` already at its limit? Does not count as a hit. */
export function isLimited(key: string, max: number, windowMs: number, now = Date.now()) {
  const r = recent(key, windowMs, now);
  hits.set(key, r);
  return r.length >= max ? { limited: true as const, retryAfterMs: windowMs - (now - r[0]) } : { limited: false as const };
}

/** Count one hit (for login: one FAILED attempt). */
export function recordHit(key: string, windowMs: number, now = Date.now()) {
  hits.set(key, [...recent(key, windowMs, now), now]);
}

export function clearHits(key: string) {
  hits.delete(key);
}

/** Check-and-count in one call. */
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()) {
  const state = isLimited(key, max, windowMs, now);
  if (!state.limited) recordHit(key, windowMs, now);
  return state.limited ? { ok: false as const, retryAfterMs: state.retryAfterMs } : { ok: true as const };
}

export function resetRateLimit(key?: string) {
  if (key) hits.delete(key);
  else hits.clear();
}
