import type { SearchFilters } from "./filters";
import type { Permit, SearchResponse } from "./types";
import type { SourceAdapter } from "./sources/types";
import type { EnrichmentResult } from "./enrich/types";
import type { CoverageReport } from "./coverage";

/**
 * Ports.
 *
 * Every capability the application needs, expressed as an interface it can be
 * handed rather than something it reaches out and constructs. The API routes
 * depend only on these; the container in lib/container.ts decides which
 * implementation satisfies each one.
 *
 * The practical payoff: swapping live HTTP feeds for fixtures in a test, or
 * Supabase for an in-memory store, is a container change and nothing else.
 */

/** Wall-clock, injected so freshness scoring is deterministic under test. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Read-through cache for permits the session has already seen. */
export interface PermitCache {
  get(id: string): Permit | null;
  put(permits: Permit[]): void;
  size(): number;
}

/** Durable storage. Optional: the app runs without it, against live feeds only. */
export interface PermitStore {
  available(): boolean;
  findById(id: string): Promise<Permit | null>;
  upsert(permits: Permit[]): Promise<number>;
}

/** The set of upstream feeds, and which of them serve a given query. */
export interface SourceCatalog {
  all(): SourceAdapter[];
  matching(filters: SearchFilters): SourceAdapter[];
  byId(id: string): SourceAdapter | undefined;
  isArchival(id: string): boolean;
}

export interface SearchOutcome extends SearchResponse {
  coverage: CoverageReport;
  coverage_warnings: Array<{ field: string; label: string; pct: number; message: string }>;
  sources: Array<{ id: string; label: string; cadence: string; archival: boolean; notes: string | null }>;
}

/** The core read path: fan out, normalize, merge, report. */
export interface SearchOptions {
  signal?: AbortSignal;
  /** Return the whole candidate set up to this size, ignoring pagination. */
  poolSize?: number;
}

export interface PermitSearchService {
  search(filters: SearchFilters, opts?: SearchOptions): Promise<SearchOutcome>;
  getById(id: string, filters?: SearchFilters, signal?: AbortSignal): Promise<Permit | null>;
}

/** Firm -> decision maker resolution. */
export interface EnrichmentService {
  configuredProviders(): string[];
  enrich(permit: Permit, opts?: { creditBudget?: number; signal?: AbortSignal }): Promise<EnrichmentResult>;
}

/** Everything an API route is allowed to reach for. */
export interface AppContainer {
  clock: Clock;
  cache: PermitCache;
  store: PermitStore;
  catalog: SourceCatalog;
  search: PermitSearchService;
  enrichment: EnrichmentService;
}
