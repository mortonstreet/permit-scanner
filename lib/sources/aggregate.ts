import type { SearchFilters } from "../filters";
import { daysSincePosted, type Permit, type SearchResponse } from "../types";
import type { SourceAdapter } from "./types";

/**
 * Runs every adapter that matches the filters, in parallel, then merges.
 *
 * Sources vary wildly in what they can filter server-side, so after merging we
 * re-apply the full filter set locally. That is the only way a search means the
 * same thing regardless of which jurisdictions happened to answer.
 */

/**
 * How many rows to pull per source before local filtering trims them down.
 *
 * Sources sort newest-first, so the window we pull is the freshest slice - which
 * is the right slice for this product. The floor is deliberately high: a low cap
 * makes a wide date range return *fewer* rows than a narrow one, because each
 * source truncates before the date filter has done any work.
 */
function overFetchBudget(filters: SearchFilters, sourceCount: number): number {
  const needed = filters.page * filters.size;
  // Local filtering can discard a lot, so pull a multiple of what we display.
  const perSource = Math.ceil((needed * 6) / Math.max(sourceCount, 1));
  return Math.min(Math.max(perSource, 500), 1000);
}

/**
 * Which filters the aggregator had to apply itself rather than push upstream.
 *
 * When this is empty, the sum of the sources' own counts is the true total and
 * we can report it exactly. When it is not, the locally filtered count is only
 * a floor over the slice we pulled.
 */
function localOnlyFilters(filters: SearchFilters, adapters: SourceAdapter[]): boolean {
  if (filters.permit_tags?.length || filters.permit_tags_exclude?.length) return true;
  if (filters.permit_status?.length) return true;
  if (filters.property_type?.length) return true;
  if (filters.contractor_name || filters.legal_owner) return true;
  if (filters.permit_max_job_value != null) return true;
  if (filters.property_min_unit_count != null || filters.property_max_unit_count != null) return true;
  if (filters.property_min_year_built != null || filters.property_max_year_built != null) return true;
  // A keyword or value filter is only pushed down by sources that can express it.
  if (filters.permit_q && adapters.some((a) => !a.descriptor.capabilities.textSearch)) return true;
  if (filters.permit_min_job_value != null && adapters.some((a) => !a.descriptor.capabilities.jobValue)) return true;
  return false;
}

export function matchesLocally(permit: Permit, f: SearchFilters): boolean {
  if (f.permit_status?.length && !f.permit_status.includes(permit.status as never)) return false;

  if (f.permit_q) {
    const needle = f.permit_q.toLowerCase();
    const haystack = [permit.description, permit.permit_type, permit.address, permit.permit_number]
      .filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  if (f.permit_tags?.length && !f.permit_tags.some((t) => permit.tags.includes(t as never))) return false;
  if (f.permit_tags_exclude?.length && f.permit_tags_exclude.some((t) => permit.tags.includes(t as never))) return false;

  if (f.permit_min_job_value != null && (permit.job_value ?? -1) < f.permit_min_job_value) return false;
  if (f.permit_max_job_value != null && (permit.job_value ?? Number.MAX_SAFE_INTEGER) > f.permit_max_job_value) return false;
  if (f.permit_min_fees != null && (permit.fees ?? -1) < f.permit_min_fees) return false;

  const basis = permit.file_date ?? permit.issue_date;
  if (f.permit_from && (!basis || basis < f.permit_from)) return false;
  if (f.permit_to && (!basis || basis > f.permit_to)) return false;

  if (f.geo_zipcode && permit.geo.zipcode !== f.geo_zipcode) return false;
  if (f.geo_city && permit.geo.city && permit.geo.city.toUpperCase() !== f.geo_city.toUpperCase()) return false;

  if (f.property_type?.length) {
    const pt = permit.property.property_type;
    if (!pt || !f.property_type.includes(pt)) return false;
  }
  if (f.property_min_unit_count != null && (permit.property.units ?? -1) < f.property_min_unit_count) return false;
  if (f.property_max_unit_count != null && (permit.property.units ?? Number.MAX_SAFE_INTEGER) > f.property_max_unit_count) return false;
  if (f.property_min_year_built != null && (permit.property.year_built ?? -1) < f.property_min_year_built) return false;
  if (f.property_max_year_built != null && (permit.property.year_built ?? Number.MAX_SAFE_INTEGER) > f.property_max_year_built) return false;
  if (f.property_min_building_area != null && (permit.property.building_area_sqft ?? -1) < f.property_min_building_area) return false;

  if (f.contractor_name) {
    const name = `${permit.contractor?.company ?? ""} ${permit.contractor?.name ?? ""}`.toLowerCase();
    if (!name.includes(f.contractor_name.toLowerCase())) return false;
  }
  if (f.legal_owner) {
    const owner = `${permit.owner?.company ?? ""} ${permit.owner?.name ?? ""}`.toLowerCase();
    if (!owner.includes(f.legal_owner.toLowerCase())) return false;
  }

  return true;
}

function sortPermits(permits: Permit[], sort: SearchFilters["sort"]): Permit[] {
  const dateOf = (p: Permit) => p.file_date ?? p.issue_date ?? "";
  const valueOf = (p: Permit) => p.job_value ?? -1;
  const sorted = [...permits];
  switch (sort) {
    case "oldest": sorted.sort((a, b) => (dateOf(a) || "9999").localeCompare(dateOf(b) || "9999")); break;
    case "value_desc": sorted.sort((a, b) => valueOf(b) - valueOf(a)); break;
    case "value_asc": sorted.sort((a, b) => valueOf(a) - valueOf(b)); break;
    default: sorted.sort((a, b) => dateOf(b).localeCompare(dateOf(a))); break;
  }
  return sorted;
}

/** Same permit reported by two overlapping sources (city + county) - keep the richer row. */
function dedupe(permits: Permit[]): Permit[] {
  const byKey = new Map<string, Permit>();
  const richness = (p: Permit) =>
    [p.job_value, p.contractor?.company, p.owner?.company, p.latitude, p.description, p.issue_date]
      .filter((v) => v != null && v !== "").length;

  for (const permit of permits) {
    // Match on permit number + address rather than our id, which is source-scoped.
    const key = `${(permit.permit_number ?? "").toUpperCase()}|${(permit.address ?? "").toUpperCase()}`;
    if (key === "|") { byKey.set(permit.id, permit); continue; }
    const existing = byKey.get(key);
    if (!existing || richness(permit) > richness(existing)) byKey.set(key, permit);
  }
  return [...byKey.values()];
}

export interface AggregateOptions {
  filters: SearchFilters;
  adapters: SourceAdapter[];
  signal?: AbortSignal;
}

export async function aggregateSearch({ filters, adapters, signal }: AggregateOptions): Promise<SearchResponse> {
  const active = adapters.filter((a) => a.matches(filters));
  const warnings: string[] = [];

  if (active.length === 0) {
    return {
      items: [], total: 0, total_is_estimate: false,
      page: filters.page, size: filters.size,
      warnings: ["No configured data source covers that area yet."],
    };
  }

  const limit = overFetchBudget(filters, active.length);

  const settled = await Promise.allSettled(
    active.map((adapter) => adapter.fetch({ filters, limit, signal })),
  );

  const collected: Permit[] = [];
  let upstreamTotal = 0;
  let everySourceCounted = true;
  let anySourceTruncated = false;

  settled.forEach((result, i) => {
    const adapter = active[i];
    if (result.status === "rejected") {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      warnings.push(`${adapter.descriptor.label} is unavailable: ${reason}`);
      everySourceCounted = false;
      return;
    }
    collected.push(...result.value.permits);
    warnings.push(...result.value.warnings);

    if (result.value.total != null) upstreamTotal += result.value.total;
    else everySourceCounted = false;
    // A source that filled its budget certainly had more to give.
    if (result.value.permits.length >= limit) anySourceTruncated = true;
  });

  const filtered = dedupe(collected).filter((p) => matchesLocally(p, filters));
  const sorted = sortPermits(filtered, filters.sort);

  const start = (filters.page - 1) * filters.size;
  const items = sorted.slice(start, start + filters.size);

  /*
   * Reporting the count honestly.
   *
   * If every source gave us its own count and we applied no filter it could not
   * express, that sum is the real total - even though we only pulled the
   * freshest slice of it. Otherwise the locally filtered count is a floor, and
   * we say so rather than presenting it as exact.
   */
  const filteredLocally = localOnlyFilters(filters, active);
  const canTrustUpstream = everySourceCounted && !filteredLocally && upstreamTotal > 0;

  const total = canTrustUpstream ? Math.max(upstreamTotal, sorted.length) : sorted.length;
  const isEstimate = canTrustUpstream ? false : anySourceTruncated;

  if (anySourceTruncated && !canTrustUpstream) {
    warnings.push(
      "More permits match than we could pull in one pass. These are the most recent; narrow the area or the date range for a complete count.",
    );
  }

  return {
    items,
    total,
    total_is_estimate: isEstimate,
    page: filters.page,
    size: filters.size,
    warnings: [...new Set(warnings)],
  };
}

/** Freshness bucket used by the results list ("11d ago"). */
export function freshnessLabel(permit: Permit, now = new Date()): string {
  const days = daysSincePosted(permit, now);
  if (days == null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
