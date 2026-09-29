// In-memory sliding-window limiter. Fine for a single app instance (our deployment model).
// If the app is ever scaled horizontally, move this to Postgres or Redis.
const hits = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { ok: false as const, retryAfterMs: windowMs - (now - recent[0]) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true as const };
}

export function resetRateLimit(key?: string) {
  if (key) hits.delete(key);
  else hits.clear();
}
