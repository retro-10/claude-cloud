import { describe, expect, it } from "vitest";
import { normalizePhone, whatsappUrl } from "@/lib/phone";
import { speedBadge } from "@/lib/speed";
import { cairoLocalToDate } from "@/lib/time";

describe("normalizePhone", () => {
  it.each([
    ["01001234567", "+201001234567"],
    ["+20 100 123 4567", "+201001234567"],
    ["0020 100 123-4567", "+201001234567"],
    ["1001234567", "+201001234567"],
    ["+2001001234567", "+201001234567"],
    ["٠١٠٠١٢٣٤٥٦٧", "+201001234567"], // Arabic-Indic digits
    ["+971 50 123 4567", "+971501234567"],
  ])("%s -> %s", (raw, out) => expect(normalizePhone(raw)).toBe(out));

  it("rejects junk and empties", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("builds a wa.me link", () => {
    expect(whatsappUrl("+201001234567")).toBe("https://wa.me/201001234567");
    expect(whatsappUrl(null)).toBeNull();
  });
});

describe("speedBadge", () => {
  const created = new Date("2026-09-29T10:00:00Z");
  const at = (min: number) => new Date(created.getTime() + min * 60_000);

  it("is ok under 5 minutes, amber from 5, red from 30", () => {
    expect(speedBadge(created, null, at(4))).toEqual({ minutes: 4, level: "ok" });
    expect(speedBadge(created, null, at(5))?.level).toBe("amber");
    expect(speedBadge(created, null, at(29))?.level).toBe("amber");
    expect(speedBadge(created, null, at(30))?.level).toBe("red");
  });

  it("disappears once contacted", () => {
    expect(speedBadge(created, at(3), at(60))).toBeNull();
  });
});

describe("cairoLocalToDate", () => {
  it("converts Cairo wall time to UTC (summer and winter offsets)", () => {
    // Egypt observes DST; whichever offset applies, converting back must land on the same wall time.
    for (const local of ["2026-01-15T09:00", "2026-07-15T09:00"]) {
      const d = cairoLocalToDate(local)!;
      const back = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Africa/Cairo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(d);
      expect(back.replace(" ", "T")).toBe(local);
    }
  });
  it("rejects garbage", () => expect(cairoLocalToDate("nope")).toBeNull());
});
