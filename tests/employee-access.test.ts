import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { can, type Role } from "@/lib/rbac";

// The access table in the HQ brief, section 13: everyone their own portal; owners everyone's records; finance pay
// terms only; nobody else anything of anyone else's.
const STAFF: Role[] = ["owner", "sales", "viewer", "finance", "instructor", "designer", "marketing"];

describe("employee records: who may open what", () => {
  it("every staff role has its own portal", () => {
    for (const r of STAFF) expect(can(r, "employee:self"), r).toBe(true);
  });
  it("only owners open other people's records and documents", () => {
    expect(STAFF.filter((r) => can(r, "employee:manage"))).toEqual(["owner"]);
  });
  it("finance (and owners) see pay terms; nobody else", () => {
    expect(STAFF.filter((r) => can(r, "employee:pay")).sort()).toEqual(["finance", "owner"]);
  });
});

describe("employee records never leave the app", () => {
  const read = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? read(join(dir, f.name)) : f.name.endsWith(".ts") ? [join(dir, f.name)] : []));
  const files = [...read("src/lib/ai"), ...read("src/lib/notion"), "src/lib/export.ts", "src/lib/csv.ts"];
  it.each(files)("%s does not read employee tables", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).not.toMatch(/employees|employeeDocuments|employeeChangeRequests|employee_documents|employee_change|from "\.\.?\/employees"/);
  });
});
