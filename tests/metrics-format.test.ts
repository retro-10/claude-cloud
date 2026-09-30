import { describe, expect, it } from "vitest";
import { fmtMinutes, fmtRate, rate } from "@/lib/metrics-format";

describe("small-sample rule", () => {
  it("shows a percentage from 5 records up, the raw count below 5, and a dash for none", () => {
    expect(fmtRate(rate(3, 5))).toBe("60.0%");
    expect(fmtRate(rate(5, 7))).toBe("71.4%");
    expect(fmtRate(rate(3, 4))).toBe("3 of 4");
    expect(fmtRate(rate(0, 1))).toBe("0 of 1");
    expect(fmtRate(rate(0, 0))).toBe("–");
  });
  it("flags small samples and keeps the raw numbers", () => {
    expect(rate(2, 4)).toMatchObject({ num: 2, den: 4, small: true });
    expect(rate(2, 5).small).toBe(false);
  });
  it("formats durations", () => {
    expect(fmtMinutes(7)).toBe("7 min");
    expect(fmtMinutes(90)).toBe("1.5 h");
    expect(fmtMinutes(null)).toBe("–");
  });
});
