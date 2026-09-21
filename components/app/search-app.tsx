"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseFilters } from "@/lib/filters";
import type { CoverageReport, CoverageWarning } from "@/lib/coverage";
import type { Permit, SearchResponse } from "@/lib/types";
import { useSearchState } from "@/lib/use-search-state";
import { ActiveFilters } from "./active-filters";
import { CoverageBanner } from "./coverage-banner";
import { FilterRail } from "./filter-rail";
import { PermitMap } from "./permit-map";
import { ResultsTable } from "./results-table";
import { ResultsTabs, type ResultTab } from "./results-tabs";
import { ContractorsView, PropertiesView } from "./rollup-views";
import { Pagination } from "./pagination";
import { toCsv, downloadCsv } from "@/lib/csv";

/** Search response plus the extra diagnostics our API returns alongside it. */
type SearchPayload = SearchResponse & {
  coverage: CoverageReport;
  coverage_warnings: CoverageWarning[];
  sources: Array<{ id: string; label: string; cadence: string; archival: boolean; notes: string | null }>;
};

export function SearchApp() {
  const { draft, setField, commit, commitNow, reset, queryString } = useSearchState();
  const [mapOpen, setMapOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const parsed = parseFilters(new URLSearchParams(queryString));
  const filters = parsed.ok ? parsed.filters : null;
  const hasGeo = Boolean(
    draft.geo_state || draft.geo_county || draft.geo_city || draft.geo_zipcode || draft.geo_jurisdiction,
  );
  const committedGeo = Boolean(
    filters && (filters.geo_state || filters.geo_county || filters.geo_city || filters.geo_zipcode || filters.geo_jurisdiction),
  );

  const { data, loading, error } = useSearch(queryString, committedGeo);

  // Stable identity so the rollup counts and CSV callback are not rebuilt each render.
  const permits = useMemo(() => data?.items ?? [], [data]);
  const tab = (filters?.tab ?? "permits") as ResultTab;

  const counts = useMemo(
    () => ({
      permits: data?.total ?? null,
      contractors: data ? countDistinct(permits, (p) => p.contractor?.company ?? p.owner?.company) : null,
      properties: data ? countDistinct(permits, (p) => p.address) : null,
    }),
    [data, permits],
  );

  const handleDownload = useCallback(() => {
    if (permits.length === 0) return;
    downloadCsv(toCsv(permits), `permits-${new Date().toISOString().slice(0, 10)}.csv`);
  }, [permits]);

  return (
    <div className="flex flex-1 overflow-hidden">
      <FilterRail
        draft={draft}
        setField={setField}
        onSearch={() => commit()}
        onReset={reset}
        coverage={data?.coverage ?? null}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <ResultsTabs
          tab={tab}
          onTabChange={(next) => commitNow({ tab: next === "permits" ? "" : next })}
          counts={counts}
          mapOpen={mapOpen}
          onToggleMap={() => setMapOpen((v) => !v)}
        />

        {filters && (
          <ActiveFilters
            filters={filters}
            onClear={(key) => commitNow({ [key]: "", [`${key}_label`]: "" })}
            onClearAll={reset}
            onDownload={handleDownload}
            downloadDisabled={permits.length === 0}
          />
        )}

        {data && (
          <CoverageBanner
            warnings={data.coverage_warnings}
            scopeLabel={data.coverage.scopeLabel}
            extraNotes={data.warnings}
          />
        )}

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto scrollbar-thin p-5">
            {!committedGeo && <GetStarted hasGeo={hasGeo} onSearch={() => commit()} />}

            {committedGeo && error && (
              <div className="rounded-xl border border-error/30 bg-error-light px-5 py-4">
                <p className="text-sm font-semibold text-error-text">Search failed</p>
                <p className="mt-1 text-[13px] text-error-text/90">{error}</p>
              </div>
            )}

            {committedGeo && !error && (
              <>
                {tab === "permits" && <ResultsTable permits={permits} loading={loading} />}
                {tab === "contractors" && <ContractorsView permits={permits} loading={loading} />}
                {tab === "properties" && <PropertiesView permits={permits} loading={loading} />}

                {data && data.total > data.size && filters && (
                  <Pagination
                    page={data.page}
                    size={data.size}
                    total={data.total}
                    isEstimate={data.total_is_estimate}
                    onPage={(page) => commitNow({ page: String(page) }, { keepPage: true })}
                  />
                )}

                {data && data.sources.length > 0 && <SourceFootnote sources={data.sources} />}
              </>
            )}
          </div>

          {mapOpen && (
            <div className="w-[42%] min-w-[320px] max-w-[640px]">
              <PermitMap permits={permits} selectedId={selectedId} onSelect={(p) => setSelectedId(p.id)} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/** Only fetch once a geography is committed; the API requires one. */
function useSearch(queryString: string, enabled: boolean) {
  const [state, setState] = useState<{ data: SearchPayload | null; loading: boolean; error: string | null }>({
    data: null, loading: false, error: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ data: prev.data, loading: true, error: null }));

    fetch(`/api/permits/search?${queryString}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `Search failed (${res.status})`);
        return body as SearchPayload;
      })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err: unknown) => {
        // A superseded request is not an error worth showing.
        if (err instanceof Error && err.name === "AbortError") return;
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Search failed" });
      });

    return () => controller.abort();
  }, [queryString, enabled]);

  return state;
}

function GetStarted({ hasGeo, onSearch }: { hasGeo: boolean; onSearch: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-background-secondary px-6 py-16 text-center">
      <p className="font-display text-lg font-semibold text-foreground">Pick an area to start</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-foreground-secondary">
        Choose a state, county, city or ZIP in the filter rail, then press Search. Florida has the
        deepest live coverage right now.
      </p>
      {hasGeo && (
        <button
          type="button"
          onClick={onSearch}
          className="mt-5 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-foreground-inverted transition-colors hover:bg-primary-hover"
        >
          Search this area
        </button>
      )}
    </div>
  );
}

function SourceFootnote({
  sources,
}: { sources: Array<{ id: string; label: string; cadence: string; archival: boolean; notes: string | null }> }) {
  return (
    <div className="mt-5 rounded-xl border border-border bg-background-panel px-4 py-3">
      <p className="label-caps mb-2">Sources queried</p>
      <ul className="space-y-1.5">
        {sources.map((s) => (
          <li key={s.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className="font-medium text-foreground">{s.label}</span>
            <span className="text-foreground-muted">· refreshes {s.cadence}</span>
            {s.archival && (
              <span className="rounded-full border border-warning-border bg-warning-light px-2 py-px text-[11px] font-semibold text-warning-text">
                archival
              </span>
            )}
            {s.notes && <span className="w-full text-foreground-secondary">{s.notes}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function countDistinct(permits: Permit[], key: (p: Permit) => string | null | undefined): number {
  const set = new Set<string>();
  for (const p of permits) {
    const v = key(p);
    if (v) set.add(v.toUpperCase());
  }
  return set.size;
}
