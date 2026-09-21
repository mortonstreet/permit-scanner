import { describe, expect, it } from "vitest";
import { normalizePhone, parseCsv, parseCsvLine } from "@/lib/enrich/gov/csv";

describe("parseCsvLine", () => {
  it("keeps commas inside quoted fields intact", () => {
    // DBPR stores qualifiers as "LAST, FIRST M" - splitting on commas
    // corrupts roughly every other row.
    const row = parseCsvLine('"06","CBC","WALTERS, DENNIS D","BUILDING CONCEPTS, LLC","TAMPA"');
    expect(row[2]).toBe("WALTERS, DENNIS D");
    expect(row[3]).toBe("BUILDING CONCEPTS, LLC");
    expect(row).toHaveLength(5);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsvLine('"a","say ""hi""","c"')[1]).toBe('say "hi"');
  });

  it("preserves empty trailing fields", () => {
    expect(parseCsvLine('"a","b",""')).toEqual(["a", "b", ""]);
  });
});

describe("parseCsv", () => {
  it("handles CRLF, a BOM and blank lines", () => {
    const rows = [...parseCsv('﻿"a","b"\r\n\r\n"c","d"\n')];
    expect(rows).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("normalizePhone", () => {
  it("normalizes the formats DBPR actually emits", () => {
    expect(normalizePhone("561-310-5822")).toBe("(561) 310-5822");
    expect(normalizePhone("(407) 832-6751")).toBe("(407) 832-6751");
    expect(normalizePhone("8328772739")).toBe("(832) 877-2739");
    expect(normalizePhone("1-407-555-1234")).toBe("(407) 555-1234");
  });

  it("rejects placeholders rather than passing them through", () => {
    expect(normalizePhone("0000000000")).toBeNull();
    expect(normalizePhone("1111111111")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});
