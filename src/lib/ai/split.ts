/** Splits a weekly-review draft (WINS / MISSES / DECISIONS headings) into the review form's fields. Pure: used in the browser. */
export function splitWeekly(text: string) {
  const grab = (h: string) => text.match(new RegExp(`(?:^|\\n)[#*\\s]*${h}[*:\\s]*\\n([\\s\\S]*?)(?=\\n[#*\\s]*(?:WINS|MISSES|DECISIONS)\\b|$)`, "i"))?.[1].trim() ?? "";
  return { wins: grab("WINS"), misses: grab("MISSES"), decisions: grab("DECISIONS") };
}
