import { describe, expect, it } from "vitest";
import { activeFilterChips, activeGeo, filtersToQuery, parseFilters, searchFiltersSchema } from "@/lib/filters";

describe("parseFilters", () => {
  it("parses the reference app's URL vocabulary", () => {
    const params = new URLSearchParams(
      "tab=permits&geo_state=FL&geo_state_label=Florida&permit_from=2026-09-01&permit_to=2026-09-21&permit_q=construction",
    );
    const result = parseFilters(params);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters.geo_state).toBe("FL");
    expect(result.filters.permit_q).toBe("construction");
    expect(result.filters.size).toBe(15);
  });

  it("splits comma-separated list params", () => {
    const result = parseFilters(new URLSearchParams("permit_tags=excavation,sitework&permit_status=active,final"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters.permit_tags).toEqual(["excavation", "sitework"]);
    expect(result.filters.permit_status).toEqual(["active", "final"]);
  });

  it("rejects a backwards date range instead of silently returning nothing", () => {
    const result = parseFilters(new URLSearchParams("permit_from=2026-09-21&permit_to=2026-09-01"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/on or before/);
  });

  it("rejects a malformed date with a useful message", () => {
    const result = parseFilters(new URLSearchParams("permit_from=09/01/2026"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/YYYY-MM-DD/);
  });

  it("uppercases state codes so fl and FL behave identically", () => {
    const result = parseFilters(new URLSearchParams("geo_state=fl"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filters.geo_state).toBe("FL");
  });
});

describe("activeGeo", () => {
  it("prefers the narrowest geography the user set", () => {
    const filters = searchFiltersSchema.parse({ geo_state: "FL", geo_county: "Alachua", geo_city: "Gainesville" });
    expect(activeGeo(filters)?.type).toBe("city");
  });

  it("returns null when no area is chosen", () => {
    expect(activeGeo(searchFiltersSchema.parse({}))).toBeNull();
  });
});

describe("filtersToQuery", () => {
  it("omits defaults so shared URLs stay short", () => {
    const query = filtersToQuery({ geo_state: "FL", size: 15, page: 1, tab: "permits", sort: "newest" });
    expect(query).toBe("geo_state=FL");
  });

  it("round-trips through parseFilters", () => {
    const original = searchFiltersSchema.parse({ geo_state: "TX", permit_q: "excavation", permit_min_job_value: "50000" });
    const reparsed = parseFilters(new URLSearchParams(filtersToQuery(original)));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.filters.geo_state).toBe("TX");
    expect(reparsed.filters.permit_min_job_value).toBe(50_000);
  });
});

describe("activeFilterChips", () => {
  it("produces a chip per active filter, labelled for display", () => {
    const filters = searchFiltersSchema.parse({
      geo_state: "FL", geo_state_label: "Florida",
      permit_from: "2026-09-01", permit_to: "2026-09-21", permit_q: "construction",
    });
    const labels = activeFilterChips(filters).map((c) => c.label);
    expect(labels).toContain("State: Florida");
    expect(labels).toContain("Issued after 09/01/2026");
    expect(labels).toContain("Keyword: construction");
  });
});
