// Temporary step timing for production diagnosis: with DEBUG_TIMING=1, each step logs its name and the time since the
// request's first step. No personal data: step names only.
export function stepTimer(scope: string) {
  if (process.env.DEBUG_TIMING !== "1") return (_step: string) => {};
  const t0 = Date.now();
  return (step: string) => console.log(`[timing] ${scope} ${step} +${Date.now() - t0}ms`);
}
