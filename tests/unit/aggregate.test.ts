import { describe, expect, it } from "vitest";
import { aggregateSearch, freshnessLabel, matchesLocally } from "@/lib/sources/aggregate";
import { searchFiltersSchema } from "@/lib/filters";
import { buildPermit } from "@/lib/normalize";
import type { Permit } from "@/lib/types";
import type { SourceAdapter } from "@/lib/sources/types";

function permit(overrides: Partial<Permit> = {}): Permit {
  return buildPermit({
    source_id: "test",
    permit_number: "P-1",
    address: "123 Main St",
    file_date: "2026-09-10",
    geo: { state: "FL", county: "Lee", city: "Cape Coral", zipcode: "33904", jurisdiction: "Cape Coral" },
    ...overrides,
  });
}

function stubAdapter(id: string, permits: Permit[], opts: { fail?: boolean } = {}): SourceAdapter {
  return {
    descriptor: {
      id, label: id, platform: "static", state: "FL", jurisdiction: id, cadence: "daily",
      capabilities: {
        dateRange: true, textSearch: true, exactCount: true, pagination: true,
        contractor: true, owner: true, jobValue: true, latLng: true,
      },
    },
    matches: () => true,
    async fetch() {
      if (opts.fail) throw new Error("upstream exploded");
      return { permits, warnings: [] };
    },
    async probe() { return { ok: true, detail: "stub" }; },
  };
}

describe("matchesLocally", () => {
  it("re-applies filters a weak source could not express server-side", () => {
    const p = permit({ job_value: 10_000, tags: ["roofing"] });
    expect(matchesLocally(p, searchFiltersSchema.parse({ permit_min_job_value: "50000" }))).toBe(false);
    expect(matchesLocally(p, searchFiltersSchema.parse({ permit_tags: "excavation" }))).toBe(false);
    expect(matchesLocally(p, searchFiltersSchema.parse({ permit_tags: "roofing" }))).toBe(true);
  });

  it("excludes tags the user explicitly filtered out", () => {
    const p = permit({ tags: ["excavation", "roofing"] });
    expect(matchesLocally(p, searchFiltersSchema.parse({ permit_tags_exclude: "roofing" }))).toBe(false);
  });

  it("drops permits with no date when a date range is set", () => {
    const p = permit({ file_date: null, issue_date: null });
    expect(matchesLocally(p, searchFiltersSchema.parse({ permit_from: "2026-01-01" }))).toBe(false);
  });

  it("matches keywords across description, type and address", () => {
    const p = permit({ description: "NEW SFR EXCAVATION" });
    expect(matchesLocally(p, searchFiltersSchema.parse({ permit_q: "excavation" }))).toBe(true);
    expect(matchesLocally(p, searchFiltersSchema.parse({ permit_q: "solar" }))).toBe(false);
  });
});

describe("aggregateSearch", () => {
  const filters = searchFiltersSchema.parse({ geo_state: "FL", size: "10" });

  it("merges results from multiple sources", async () => {
    const a = stubAdapter("a", [permit({ permit_number: "A-1", address: "1 A St" })]);
    const b = stubAdapter("b", [permit({ permit_number: "B-1", address: "2 B St" })]);
    const result = await aggregateSearch({ filters, adapters: [a, b] });
    expect(result.items).toHaveLength(2);
  });

  it("degrades gracefully when one source fails, and says so", async () => {
    const ok = stubAdapter("ok", [permit({ permit_number: "OK-1", address: "1 Ok St" })]);
    const bad = stubAdapter("bad", [], { fail: true });
    const result = await aggregateSearch({ filters, adapters: [ok, bad] });
    expect(result.items).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/bad is unavailable/);
  });

  it("dedupes the same permit reported by two overlapping sources, keeping the richer row", async () => {
    const thin = stubAdapter("city", [permit({ permit_number: "X-9", address: "5 Elm St" })]);
    const rich = stubAdapter("county", [
      permit({ permit_number: "X-9", address: "5 Elm St", job_value: 250_000, latitude: 26.5, longitude: -81.9 }),
    ]);
    const result = await aggregateSearch({ filters, adapters: [thin, rich] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].job_value).toBe(250_000);
  });

  it("sorts newest first by default", async () => {
    const a = stubAdapter("a", [
      permit({ permit_number: "OLD", address: "1 Old St", file_date: "2026-01-01" }),
      permit({ permit_number: "NEW", address: "2 New St", file_date: "2026-09-20" }),
    ]);
    const result = await aggregateSearch({ filters, adapters: [a] });
    expect(result.items[0].permit_number).toBe("NEW");
  });

  it("explains itself when no source covers the area", async () => {
    const elsewhere: SourceAdapter = { ...stubAdapter("tx", []), matches: () => false };
    const result = await aggregateSearch({ filters, adapters: [elsewhere] });
    expect(result.items).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/No configured data source/);
  });

  it("paginates over the merged set", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      permit({ permit_number: `P-${i}`, address: `${i} Main St`, file_date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` }));
    const a = stubAdapter("a", many);
    const page2 = await aggregateSearch({
      filters: searchFiltersSchema.parse({ geo_state: "FL", size: "10", page: "2" }),
      adapters: [a],
    });
    expect(page2.items).toHaveLength(10);
    expect(page2.page).toBe(2);
    expect(page2.total).toBe(25);
  });
});

describe("freshnessLabel", () => {
  const now = new Date("2026-09-21T00:00:00Z");
  it("reads in the units a contractor thinks in", () => {
    expect(freshnessLabel(permit({ file_date: "2026-09-21" }), now)).toBe("today");
    expect(freshnessLabel(permit({ file_date: "2026-09-20" }), now)).toBe("1d ago");
    expect(freshnessLabel(permit({ file_date: "2026-09-10" }), now)).toBe("11d ago");
    expect(freshnessLabel(permit({ file_date: "2026-06-21" }), now)).toBe("3mo ago");
  });

  it("shows a dash rather than inventing a date", () => {
    expect(freshnessLabel(permit({ file_date: null, issue_date: null }), now)).toBe("—");
  });
});
