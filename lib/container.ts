import "server-only";
import type {
  AppContainer, Clock, EnrichmentService, PermitCache, PermitStore,
  PermitSearchService, SearchOptions, SearchOutcome, SourceCatalog,
} from "./ports";
import { systemClock } from "./ports";
import type { SearchFilters } from "./filters";
import { activeGeo } from "./filters";
import type { Permit } from "./types";
import { ALL_SOURCES, ARCHIVAL_SOURCE_IDS, sourceById } from "./sources/registry";
import type { SourceAdapter } from "./sources/types";
import { aggregateSearch } from "./sources/aggregate";
import { computeCoverage, coverageWarnings, fieldsUsedByFilters } from "./coverage";
import { cachePermits, cacheSize, getCachedPermit } from "./cache";
import { getPermitById, upsertPermits } from "./supabase/permits";
import { isSupabaseConfigured } from "./supabase/client";
import { configuredProviders, enrichPermit } from "./enrich";

/**
 * Composition root.
 *
 * The one place that decides which implementation satisfies each port. Routes
 * call getContainer(); nothing else constructs a dependency directly.
 *
 * `createContainer` takes overrides so a test can substitute a fixture catalog
 * or a frozen clock without touching the code under test.
 */

/* ── default adapters over the existing modules ─────────────────────────── */

const defaultCache: PermitCache = {
  get: (id) => getCachedPermit(id),
  put: (permits) => cachePermits(permits),
  size: () => cacheSize(),
};

const defaultStore: PermitStore = {
  available: () => isSupabaseConfigured(),
  findById: (id) => getPermitById(id),
  upsert: (permits) => upsertPermits(permits),
};

export function createSourceCatalog(adapters: SourceAdapter[] = ALL_SOURCES): SourceCatalog {
  return {
    all: () => adapters,
    matching: (filters) => adapters.filter((a) => a.matches(filters)),
    byId: (id) => adapters.find((a) => a.descriptor.id === id) ?? sourceById(id),
    isArchival: (id) => ARCHIVAL_SOURCE_IDS.has(id),
  };
}

const defaultEnrichment: EnrichmentService = {
  configuredProviders,
  enrich: (permit, opts) => enrichPermit(permit, opts ?? {}),
};

/* ── the search service, built from the ports it needs ──────────────────── */

export function createSearchService(deps: {
  catalog: SourceCatalog;
  cache: PermitCache;
  store: PermitStore;
}): PermitSearchService {
  const { catalog, cache, store } = deps;

  return {
    async search(filters: SearchFilters, opts: SearchOptions = {}): Promise<SearchOutcome> {
      const { signal, poolSize } = opts;
      const result = await aggregateSearch({ filters, adapters: catalog.all(), signal, poolSize });
      cache.put(result.items);

      const geo = activeGeo(filters);
      const report = computeCoverage(result.items, geo?.label ?? "this area");

      // Only warn about fields the user is actually filtering on.
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v != null && v !== "") params.set(k, Array.isArray(v) ? v.join(",") : String(v));
      }
      const warnings = coverageWarnings(report, fieldsUsedByFilters(params));

      const used = catalog.matching(filters).map((a) => a.descriptor);
      const live = used.filter((d) => !catalog.isArchival(d.id));

      const extraWarnings = [...result.warnings];
      if (used.length > 0 && live.length === 0) {
        extraWarnings.unshift(
          "Every source covering this area is archival. These results are historical, not current filings.",
        );
      }

      return {
        ...result,
        warnings: extraWarnings,
        coverage: report,
        coverage_warnings: warnings,
        sources: used.map((d) => ({
          id: d.id, label: d.label, cadence: d.cadence,
          archival: catalog.isArchival(d.id), notes: d.notes ?? null,
        })),
      };
    },

    /**
     * Cache, then store, then - if the caller supplied the search that produced
     * the row - a re-run of it. The third path exists because the upstream feeds
     * have no by-id endpoint, so a shared link would otherwise break on restart.
     */
    async getById(id: string, filters?: SearchFilters, signal?: AbortSignal): Promise<Permit | null> {
      const cached = cache.get(id);
      if (cached) return cached;

      if (store.available()) {
        const stored = await store.findById(id);
        if (stored) return stored;
      }

      if (filters && activeGeo(filters)) {
        const result = await aggregateSearch({
          filters: { ...filters, page: 1, size: 100 },
          adapters: catalog.all(),
          signal,
        });
        cache.put(result.items);
        return result.items.find((p) => p.id === id) ?? null;
      }
      return null;
    },
  };
}

/* ── the container ───────────────────────────────────────────────────────── */

export interface ContainerOverrides {
  clock?: Clock;
  cache?: PermitCache;
  store?: PermitStore;
  catalog?: SourceCatalog;
  enrichment?: EnrichmentService;
  search?: PermitSearchService;
}

export function createContainer(overrides: ContainerOverrides = {}): AppContainer {
  const clock = overrides.clock ?? systemClock;
  const cache = overrides.cache ?? defaultCache;
  const store = overrides.store ?? defaultStore;
  const catalog = overrides.catalog ?? createSourceCatalog();
  const enrichment = overrides.enrichment ?? defaultEnrichment;
  const search = overrides.search ?? createSearchService({ catalog, cache, store });

  return { clock, cache, store, catalog, search, enrichment };
}

/**
 * Process-wide singleton, pinned to globalThis because Next compiles each route
 * into its own module registry and we want one shared cache across them.
 */
const g = globalThis as typeof globalThis & { __permitContainer?: AppContainer };

export function getContainer(): AppContainer {
  return (g.__permitContainer ??= createContainer());
}

/** Test seam: install a container built from fixtures. */
export function setContainer(container: AppContainer): void {
  g.__permitContainer = container;
}
