/**
 * A same-site path taken from a form ("back" fields), or the fallback. Rejects anything a browser
 * could read as another origin: "//host", "/\host" (browsers treat \ as /), schemes, control characters.
 */
export function safePath(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v : "";
  return /^\/(?![/\\])/.test(s) && !/[\\\u0000-\u001f\u007f]/.test(s) && s.length <= 500 ? s : fallback;
}
