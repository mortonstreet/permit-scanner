import { NextResponse } from "next/server";
import { parseFilters } from "@/lib/filters";
import { aggregateSearch } from "@/lib/sources/aggregate";
import { ARCHIVAL_SOURCE_IDS, ALL_SOURCES } from "@/lib/sources/registry";
import { computeCoverage, coverageWarnings, fieldsUsedByFilters } from "@/lib/coverage";
import { cachePermits } from "@/lib/cache";
import { activeGeo } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * GET /api/permits/search
 *
 * Fans out across every source covering the requested area, merges and
 * re-filters, then reports field coverage alongside the results so the client
 * can warn when a filter is running against sparsely-reported data.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseFilters(url.searchParams);

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const filters = parsed.filters;

  const geo = activeGeo(filters);
  if (!geo) {
    return NextResponse.json(
      { error: "Choose a state, county, city or ZIP before searching." },
      { status: 400 },
    );
  }

  try {
    const result = await aggregateSearch({
      filters,
      adapters: ALL_SOURCES,
      signal: request.signal,
    });

    cachePermits(result.items);

    // Coverage is measured over the whole filtered set, not just the page shown.
    const report = computeCoverage(result.items, geo.label);
    const warnings = coverageWarnings(report, fieldsUsedByFilters(url.searchParams));

    const usedSources = ALL_SOURCES.filter((a) => a.matches(filters)).map((a) => a.descriptor);
    const liveSources = usedSources.filter((d) => !ARCHIVAL_SOURCE_IDS.has(d.id));

    // Being explicit beats silently returning stale rows as if they were leads.
    const extraWarnings = [...result.warnings];
    if (usedSources.length > 0 && liveSources.length === 0) {
      extraWarnings.unshift(
        "Every source covering this area is archival. These results are historical, not current filings.",
      );
    }

    return NextResponse.json({
      ...result,
      warnings: extraWarnings,
      coverage: report,
      coverage_warnings: warnings,
      sources: usedSources.map((d) => ({
        id: d.id, label: d.label, cadence: d.cadence,
        archival: ARCHIVAL_SOURCE_IDS.has(d.id), notes: d.notes ?? null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
