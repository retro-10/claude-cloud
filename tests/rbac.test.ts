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

  it("finance sees everything and handles payments, but edits no leads, settings or users", () => {
    for (const a of ["lead:read", "payment:write", "revenue:export"] as const) expect(can("finance", a)).toBe(true);
    for (const a of ["lead:write", "lead:delete", "settings:write", "users:manage", "audit:read"] as const)
      expect(can("finance", a)).toBe(false);
  });

  it("only owners can download the lead list; only owner and finance see revenue", () => {
    expect(can("owner", "lead:export")).toBe(true);
    for (const r of ["sales", "viewer", "finance"] as const) expect(can(r, "lead:export")).toBe(false);
    for (const r of ["owner", "finance"] as const) expect(can(r, "finance:read")).toBe(true);
    for (const r of ["sales", "viewer"] as const) expect(can(r, "finance:read")).toBe(false);
  });

  it("only owner and finance can touch payments or export revenue", () => {
    for (const r of ["sales", "viewer"] as const) {
      expect(can(r, "payment:write")).toBe(false);
      expect(can(r, "revenue:export")).toBe(false);
    }
    expect(can("owner", "payment:write") && can("owner", "revenue:export")).toBe(true);
  });
});
