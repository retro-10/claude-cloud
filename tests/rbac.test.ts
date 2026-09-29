import { describe, expect, it } from "vitest";
import { can } from "@/lib/rbac";

describe("role rules", () => {
  it("owner can do everything", () => {
    for (const a of ["lead:read", "lead:write", "lead:delete", "settings:write", "users:manage", "audit:read"] as const)
      expect(can("owner", a)).toBe(true);
  });

  it("sales can read and write leads but not delete or change settings", () => {
    expect(can("sales", "lead:read")).toBe(true);
    expect(can("sales", "lead:write")).toBe(true);
    expect(can("sales", "lead:delete")).toBe(false);
    expect(can("sales", "settings:write")).toBe(false);
    expect(can("sales", "users:manage")).toBe(false);
    expect(can("sales", "audit:read")).toBe(false);
  });

  it("viewer is read-only", () => {
    expect(can("viewer", "lead:read")).toBe(true);
    expect(can("viewer", "lead:write")).toBe(false);
    expect(can("viewer", "lead:delete")).toBe(false);
    expect(can("viewer", "settings:write")).toBe(false);
  });

  it("finance is read-only until its permissions are defined", () => {
    expect(can("finance", "lead:read")).toBe(true);
    for (const a of ["lead:write", "lead:delete", "settings:write", "users:manage", "audit:read"] as const)
      expect(can("finance", a)).toBe(false);
  });
});
