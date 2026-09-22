import { describe, expect, it } from "vitest";
import {
  inferTags, normalizePropertyType, normalizeStatus, parseDate,
  normalizePartyName, parseLatLng, parseMoney, permitId, titleCase,
} from "@/lib/normalize";

describe("normalizeStatus", () => {
  it("maps jurisdiction phrasings onto the canonical statuses", () => {
    expect(normalizeStatus("ISSUED")).toBe("active");
    expect(normalizeStatus("Certificate of Occupancy")).toBe("final");
    expect(normalizeStatus("Plan Check")).toBe("in_review");
    expect(normalizeStatus("VOIDED")).toBe("inactive");
  });

  it("returns unknown rather than guessing", () => {
    expect(normalizeStatus(null)).toBe("unknown");
    expect(normalizeStatus("")).toBe("unknown");
    expect(normalizeStatus("Zebra")).toBe("unknown");
  });
});

describe("inferTags", () => {
  it("treats excavation as the headline tag on a new-build site permit", () => {
    const tags = inferTags("EXCAVATION FOR NEW SFR", "Site Permit");
    expect(tags).toContain("excavation");
    expect(tags).toContain("new_construction");
  });

  it("reads Florida DEP marine language as ground-disturbing work", () => {
    expect(inferTags("SEAWALL REPLACEMENT", null)).toContain("excavation");
    expect(inferTags("SUBAQUAEOUS POWERLINE CROSSING", null)).toContain("utilities");
    expect(inferTags("COMMERCIAL DEVELOPMENT", null)).toContain("sitework");
  });

  it("returns nothing for text with no signal, instead of a default tag", () => {
    expect(inferTags(null, null)).toEqual([]);
    expect(inferTags("2602 SE 21ST PL", null)).toEqual([]);
  });
});

describe("parseMoney", () => {
  it("handles the formats jurisdictions actually emit", () => {
    expect(parseMoney("$1,250,000.00")).toBe(1_250_000);
    expect(parseMoney(1250000)).toBe(1_250_000);
    expect(parseMoney("1250000")).toBe(1_250_000);
  });

  it("rejects junk rather than coercing it to zero", () => {
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("N/A")).toBeNull();
    expect(parseMoney("-")).toBeNull();
  });
});

describe("parseDate", () => {
  it("accepts ISO, US and ArcGIS epoch-millisecond dates", () => {
    expect(parseDate("2026-09-20T00:00:00.000")).toBe("2026-09-20");
    expect(parseDate("9/20/2026")).toBe("2026-09-20");
    expect(parseDate(1_758_326_400_000)).toBe("2025-09-20");
  });

  it("returns null for unparseable input", () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate("not a date")).toBeNull();
  });
});

describe("parseLatLng", () => {
  it("keeps valid coordinates", () => {
    expect(parseLatLng(27.87, -82.43)).toEqual({ latitude: 27.87, longitude: -82.43 });
  });

  it("rejects null island and out-of-range values", () => {
    expect(parseLatLng(0, 0)).toEqual({ latitude: null, longitude: null });
    expect(parseLatLng(91, -82)).toEqual({ latitude: null, longitude: null });
    expect(parseLatLng("abc", "def")).toEqual({ latitude: null, longitude: null });
  });
});

describe("titleCase", () => {
  it("fixes screaming addresses but keeps directionals uppercase", () => {
    expect(titleCase("2602 SE 21ST PL")).toBe("2602 SE 21ST Pl");
    expect(titleCase("HILLSBOROUGH BAY")).toBe("Hillsborough Bay");
  });

  it("leaves already mixed-case text alone", () => {
    expect(titleCase("McDonald Farms")).toBe("McDonald Farms");
  });
});

describe("permitId", () => {
  it("is stable across runs so re-ingestion updates rather than duplicates", () => {
    const a = permitId("fl-fdep-erp", "0263470-003-BN", "123 Main St");
    const b = permitId("fl-fdep-erp", "0263470-003-bn", "123 main st");
    expect(a).toBe(b);
  });

  it("separates the same permit number across different sources", () => {
    expect(permitId("src-a", "123", "x")).not.toBe(permitId("src-b", "123", "x"));
  });
});

describe("normalizePropertyType", () => {
  it("classifies from free text", () => {
    expect(normalizePropertyType("SINGLE FAMILY DWELLING")).toBe("residential");
    expect(normalizePropertyType("WAREHOUSE")).toBe("industrial");
    expect(normalizePropertyType("Mixed-Use Tower")).toBe("mixed");
  });

  it("returns null when nothing matches", () => {
    expect(normalizePropertyType("???")).toBeNull();
  });
});

describe("normalizePartyName", () => {
  it("treats 'TO BE BID' as no contractor, not a contractor named that", () => {
    // Phoenix writes this literally to mean the grading contractor has not
    // been selected. Reading it as a name would invert the whole signal.
    const r = normalizePartyName("TO BE BID");
    expect(r.name).toBeNull();
    expect(r.placeholder).toBe("TO BE BID");
  });

  it("catches the other placeholder spellings jurisdictions use", () => {
    for (const v of ["TBD", "N/A", "NONE", "To Be Determined", "UNKNOWN", "---", "Owner Builder", "SAME AS OWNER"]) {
      expect(normalizePartyName(v).name, `${v} should be treated as absent`).toBeNull();
    }
  });

  it("leaves real firm names alone", () => {
    expect(normalizePartyName("Talbot Custom Homes LLC").name).toBe("Talbot Custom Homes LLC");
    expect(normalizePartyName("DRB Group Florida LLC").placeholder).toBeNull();
    // A real firm whose name merely contains a placeholder word must survive.
    expect(normalizePartyName("Owner Builder Supply Co").name).toBe("Owner Builder Supply Co");
  });

  it("handles empty input without inventing a placeholder", () => {
    expect(normalizePartyName(null)).toEqual({ name: null, placeholder: null });
    expect(normalizePartyName("   ")).toEqual({ name: null, placeholder: null });
  });
});
