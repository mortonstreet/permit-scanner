import type { Permit } from "../types";
import type { SearchFilters } from "../filters";

/**
 * A source adapter knows how to pull permits out of exactly one upstream system
 * (one Socrata dataset, one ArcGIS layer, one Apify actor, the Shovels API...).
 *
 * Adapters are pure I/O + mapping. All filtering semantics that a source cannot
 * express natively are re-applied in-process by the aggregator, so a weak source
 * never silently returns wrong results - it just does more work locally.
 */

export type SourcePlatform = "socrata" | "arcgis" | "apify" | "shovels" | "static";

/**
 * Where in a project's life this source's records appear.
 *
 * This is the single most important property of a source, because it decides
 * whether a record is a lead or a history entry. Measured windows:
 *
 *   entitlement    site plan submitted -> approved: ~170 days median (Raleigh)
 *   pre_permit     environmental or grading filing, ahead of the build permit
 *   permit_review  permit applied -> issued: 28 days Raleigh, 2 days Orlando
 *   issued         the contractor is engaged; this is history
 *
 * The entitlement window is roughly sixty times the permit-review window in a
 * fast-permitting city. A product built on issued permits is selling history.
 */
export type ProjectStage = "entitlement" | "pre_permit" | "permit_review" | "issued";

export interface SourceCapabilities {
  /** Can the upstream filter by a date range server-side? */
  dateRange: boolean;
  /** Full-text search over the description server-side? */
  textSearch: boolean;
  /** Server-side result count without pulling all rows? */
  exactCount: boolean;
  /** Server-side pagination (offset/limit)? */
  pagination: boolean;
  /** Does the source expose the contractor / owner name at all? */
  contractor: boolean;
  owner: boolean;
  jobValue: boolean;
  latLng: boolean;
}

export interface SourceDescriptor {
  /** Stable registry key, e.g. "fl-gainesville-socrata". */
  id: string;
  label: string;
  platform: SourcePlatform;
  /** Two-letter state this source covers. */
  state: string;
  /** County name, when the source is county-scoped. */
  county?: string;
  /** City name, when the source is city-scoped. */
  city?: string;
  /** The permitting authority as it should appear in the UI. */
  jurisdiction: string;
  /** Roughly how often the upstream refreshes, for the freshness badge. */
  cadence: "realtime" | "daily" | "weekly" | "monthly" | "unknown";
  /**
   * The earliest stage this source's records represent. Defaults to "issued",
   * because most permit feeds publish issued permits and that is the safe
   * assumption - claiming a source is early when it is not would be the
   * expensive mistake.
   */
  stage?: ProjectStage;
  capabilities: SourceCapabilities;
  /** Set when the source needs a key we may not have configured. */
  requiresCredential?: string;
  notes?: string;
}

export interface FetchArgs {
  filters: SearchFilters;
  /** Hard cap on rows this adapter should pull for one query. */
  limit: number;
  signal?: AbortSignal;
}

export interface FetchResult {
  permits: Permit[];
  /** Upstream's own count when it can give one cheaply. */
  total?: number;
  /** Non-fatal problems worth surfacing, e.g. "field X missing in this dataset". */
  warnings: string[];
}

export interface SourceAdapter {
  descriptor: SourceDescriptor;
  /** Should this adapter run for these filters? (geography/date gating) */
  matches(filters: SearchFilters): boolean;
  fetch(args: FetchArgs): Promise<FetchResult>;
  /** Cheap liveness probe used by `pnpm sources:probe`. */
  probe(): Promise<{ ok: boolean; rows?: number; detail: string }>;
}

/** Thrown by adapters on upstream failure so the aggregator can degrade gracefully. */
export class SourceError extends Error {
  constructor(readonly sourceId: string, message: string, readonly cause?: unknown) {
    super(`[${sourceId}] ${message}`);
    this.name = "SourceError";
  }
}

/** fetch() with a timeout and a descriptive error, used by every adapter. */
export async function fetchJson<T = unknown>(
  url: string,
  opts: { sourceId: string; timeoutMs?: number; signal?: AbortSignal; headers?: Record<string, string> },
): Promise<T> {
  const { sourceId, timeoutMs = 20_000, signal, headers } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "permit-scanner/0.1", ...headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new SourceError(sourceId, `HTTP ${res.status} ${res.statusText} - ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof SourceError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new SourceError(sourceId, `timed out after ${timeoutMs}ms`);
    }
    throw new SourceError(sourceId, err instanceof Error ? err.message : String(err), err);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
