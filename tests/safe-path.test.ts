import { describe, expect, it } from "vitest";
import { safePath } from "@/lib/safe-path";

describe("safePath: form 'back' fields never redirect off-site", () => {
  it("keeps same-site paths", () => {
    expect(safePath("/finance/ledger?month=2026-09", "/x")).toBe("/finance/ledger?month=2026-09");
    expect(safePath("/leads/12#money", "/x")).toBe("/leads/12#money");
  });
  it("refuses other origins and odd input", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "\\\\evil.com", "https://evil.com", "javascript:alert(1)", "/ok\nLocation: x", "", null, 42, "finance"]) {
      expect(safePath(bad, "/fallback")).toBe("/fallback");
    }
  });
});
