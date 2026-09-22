import { describe, expect, it } from "vitest";
import {
  officerRank, officerTitle, parseSunbizRecord, readableName, splitPackedName,
} from "@/lib/enrich/gov/sunbiz-layout";

/**
 * A synthetic 1,440-char record built to the published SunBiz layout, so the
 * offsets are asserted rather than assumed.
 */
function buildRecord(fields: {
  doc: string; name: string; status?: string; filingType?: string;
  addr?: string; city?: string; state?: string; zip?: string;
  agentName?: string; agentType?: string; agentCity?: string;
  officers?: Array<{ title: string; type: string; name: string; city?: string; state?: string }>;
}): string {
  const buf = Array(1440).fill(" ");
  const put = (start: number, len: number, value: string) => {
    const v = (value ?? "").slice(0, len);
    for (let i = 0; i < v.length; i += 1) buf[start + i] = v[i];
  };

  put(0, 12, fields.doc);
  put(12, 192, fields.name);
  put(204, 1, fields.status ?? "A");
  put(205, 15, fields.filingType ?? "FLAL");
  put(220, 42, fields.addr ?? "");
  put(304, 28, fields.city ?? "");
  put(332, 2, fields.state ?? "FL");
  put(334, 10, fields.zip ?? "");
  put(544, 42, fields.agentName ?? "");
  put(586, 1, fields.agentType ?? "P");
  put(629, 28, fields.agentCity ?? "");

  (fields.officers ?? []).forEach((o, i) => {
    const base = 668 + i * 128;
    put(base, 4, o.title);
    put(base + 4, 1, o.type);
    put(base + 5, 42, o.name);
    put(base + 89, 28, o.city ?? "");
    put(base + 117, 2, o.state ?? "FL");
  });

  return buf.join("");
}

describe("splitPackedName", () => {
  it("slices the fixed-width name rather than splitting on whitespace", () => {
    // Surname is padded to 20 chars, then the given name. Splitting on
    // whitespace would merge a two-word surname into the first name.
    expect(splitPackedName("TOTO                TONI")).toEqual({ last: "TOTO", first: "TONI", middle: "" });
    expect(splitPackedName("DE JESUS            KATRINA M")).toEqual({ last: "DE JESUS", first: "KATRINA", middle: "M" });
  });

  it("returns null for a field too short to be packed", () => {
    expect(splitPackedName("ACME LLC")).toBeNull();
  });
});

describe("readableName", () => {
  it("renders a person in reading order", () => {
    expect(readableName("TOTO                TONI", true)).toBe("TONI TOTO");
  });

  it("leaves a company name alone", () => {
    expect(readableName("ACME HOLDINGS LLC", false)).toBe("ACME HOLDINGS LLC");
  });
});

describe("parseSunbizRecord", () => {
  it("reads every documented field at the right offset", () => {
    const line = buildRecord({
      doc: "L26000480110",
      name: "SUNSET SIGNATURE REALTY LLC",
      status: "A",
      filingType: "FLAL",
      addr: "3807 NW 40TH TERRACE",
      city: "CAPE CORAL",
      zip: "33993",
      agentName: "TOTO                TONI",
      agentType: "P",
      agentCity: "CAPE CORAL",
      officers: [{ title: "MGR", type: "P", name: "TOTO                TONI", city: "CAPE CORAL" }],
    });

    const rec = parseSunbizRecord(line);
    expect(rec).not.toBeNull();
    expect(rec!.docNumber).toBe("L26000480110");
    expect(rec!.name).toBe("SUNSET SIGNATURE REALTY LLC");
    expect(rec!.status).toBe("A");
    expect(rec!.filingType).toBe("FLAL");
    expect(rec!.city).toBe("CAPE CORAL");
    expect(rec!.state).toBe("FL");
    expect(rec!.registeredAgentName).toBe("TOTO                TONI".trim());
    expect(rec!.officers).toHaveLength(1);
    expect(rec!.officers[0].title).toBe("MGR");
    expect(readableName(rec!.officers[0].name, true)).toBe("TONI TOTO");
  });

  it("reads all six officer slots", () => {
    const officers = Array.from({ length: 6 }, (_, i) => ({
      title: "D", type: "P", name: `SURNAME${i}`.padEnd(20) + `GIVEN${i}`,
    }));
    const rec = parseSunbizRecord(buildRecord({ doc: "P12345678901", name: "SIX OFFICERS INC", officers }));
    expect(rec!.officers).toHaveLength(6);
    expect(readableName(rec!.officers[5].name, true)).toBe("GIVEN5 SURNAME5");
  });

  it("skips blank officer slots instead of emitting empty people", () => {
    const rec = parseSunbizRecord(buildRecord({
      doc: "L00000000001", name: "ONE OFFICER LLC",
      officers: [{ title: "MGRM", type: "P", name: "SMITH".padEnd(20) + "JOHN" }],
    }));
    expect(rec!.officers).toHaveLength(1);
  });

  it("rejects a truncated line rather than emitting junk", () => {
    expect(parseSunbizRecord("too short")).toBeNull();
    expect(parseSunbizRecord("")).toBeNull();
  });
});

describe("officerTitle / officerRank", () => {
  it("expands the title codes", () => {
    expect(officerTitle("MGRM")).toBe("Managing Member");
    expect(officerTitle("P")).toBe("President");
    expect(officerTitle("ZZZ")).toBe("ZZZ");
  });

  it("ranks the people who actually control a small FL entity first", () => {
    // LLC control roles outrank corporate officers: a managing member decides,
    // a secretary does not.
    expect(officerRank("MGRM")).toBeLessThan(officerRank("P"));
    expect(officerRank("P")).toBeLessThan(officerRank("S"));
    expect(officerRank("S")).toBeLessThan(officerRank("D"));
    expect(officerRank("UNKNOWN")).toBe(7);
  });
});
