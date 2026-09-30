import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv, safeCell, toCsv, unsafeCell } from "@/lib/csv";

describe("parseCsv", () => {
  it("handles quotes, embedded commas, newlines and doubled quotes", () => {
    const rows = parseCsv('name,notes\r\n"Ali, Jr.","line1\nline2"\r\nSara,"said ""hi"""\r\n');
    expect(rows).toEqual([
      ["name", "notes"],
      ["Ali, Jr.", "line1\nline2"],
      ["Sara", 'said "hi"'],
    ]);
  });

  it("strips a BOM and skips blank lines", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps empty trailing fields and a last row without newline", () => {
    expect(parseCsv("a,b,c\n1,,")).toEqual([["a", "b", "c"], ["1", "", ""]]);
  });
});

describe("toCsv", () => {
  it("round-trips Arabic, commas, quotes and newlines", () => {
    const data = [
      ["الاسم", "ملاحظات"],
      ["د. محمد، علي", 'قال "مرحبا"\nسطر ثان'],
    ];
    expect(parseCsv(toCsv(data))).toEqual(data);
  });

  it("starts with a BOM", () => expect(toCsv([["a"]]).charCodeAt(0)).toBe(0xfeff));
});

describe("formula injection", () => {
  it("prefixes dangerous cells but leaves phones and numbers alone", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeCell("@cmd")).toBe("'@cmd");
    expect(safeCell("-2+3")).toBe("'-2+3");
    expect(safeCell("+201001234567")).toBe("+201001234567");
    expect(safeCell("-5")).toBe("-5");
    expect(safeCell("hello")).toBe("hello");
  });
  it("unsafeCell undoes safeCell", () => {
    for (const v of ["=1+1", "@x", "-a+b", "+cmd|x"]) expect(unsafeCell(safeCell(v))).toBe(v);
    expect(unsafeCell("'quoted")).toBe("'quoted");
  });
});
