import type { SearchFilters } from "../filters";
import { activeGeo } from "../filters";
import { buildPermit, inferTags, normalizeStatus } from "../normalize";
import type { Permit, PermitStatus, PropertyType } from "../types";
import { type FetchArgs, type FetchResult, type SourceAdapter, type SourceDescriptor, fetchJson } from "./types";

/**
 * Shovels API v2 adapter.
 *
 * Role in this system: national normalized backfill, NOT the freshness signal.
 * Shovels' own spec puts ingestion at a median 84 days (p90 188) behind a
 * permit's start date, so anything time-sensitive must come from a direct
 * jurisdiction source. Shovels earns its place on breadth - 50 states, ~2,770
 * jurisdictions - and on licence terms that permit resale of API output.
 *
 * Spec: https://api.shovels.ai/v2/openapi.json
 */

const BASE_URL = "https://api.shovels.ai/v2";

/** Shovels returns every money field as integer cents. */
function centsToDollars(cents: number | null | undefined): number | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return Math.round(cents / 100);
}

interface ShovelsAddress {
  street_no?: string | null; street?: string | null; city?: string | null;
  county?: string | null; zip_code?: string | null; state?: string | null;
  jurisdiction?: string | null; latlng?: [number, number] | null;
}

interface ShovelsPermit {
  id: string;
  number?: string | null;
  jurisdiction: string;
  description?: string | null;
  description_derived?: string | null;
  type?: string | null;
  subtype?: string | null;
  status?: string | null;
  tags?: string[] | null;
  job_value?: number | null;
  fees?: number | null;
  file_date?: string | null;
  issue_date?: string | null;
  final_date?: string | null;
  start_date?: string | null;
  contractor_id?: string | null;
  property_type?: string | null;
  property_legal_owner?: string | null;
  property_lot_size?: number | null;
  property_building_area?: number | null;
  property_story_count?: number | null;
  property_unit_count?: number | null;
  property_year_built?: number | null;
  property_assess_market_value?: number | null;
  address?: ShovelsAddress | null;
}

interface ShovelsPage {
  items: ShovelsPermit[];
  size: number;
  next_cursor: string | null;
  total_count?: { value: number; relation: "eq" | "gte" } | null;
}

const SHOVELS_STATUS: Record<string, PermitStatus> = {
  final: "final", active: "active", in_review: "in_review", inactive: "inactive",
};

const SHOVELS_PROPERTY_TYPE: Record<string, PropertyType> = {
  residential: "residential", commercial: "commercial", industrial: "industrial",
  office: "commercial", recreational: "commercial",
  agricultural: "other", "vacant land": "other", exempt: "other", miscellaneous: "other",
};

export interface ShovelsConfig {
  /** Env var holding the key; read lazily so a missing key is a soft failure. */
  apiKeyEnv?: string;
}

export function createShovelsAdapter(config: ShovelsConfig = {}): SourceAdapter {
  const apiKeyEnv = config.apiKeyEnv ?? "SHOVELS_API_KEY";

  const descriptor: SourceDescriptor = {
    id: "shovels-national",
    label: "Shovels (national)",
    platform: "shovels",
    state: "*",
    jurisdiction: "Multiple",
    cadence: "monthly",
    requiresCredential: apiKeyEnv,
    notes:
      "National normalized coverage. Median 84-day ingestion lag, so this backfills breadth rather than supplying fresh signal.",
    capabilities: {
      dateRange: true, textSearch: true, exactCount: true, pagination: true,
      contractor: false, owner: true, jobValue: true, latLng: true,
    },
  };

  function apiKey(): string | undefined {
    return process.env[apiKeyEnv];
  }

  /**
   * Shovels takes ONE polymorphic `geo_id`: a 2-letter state, a ZIP, or an opaque
   * base64 id for city/county/jurisdiction. City and county names must be resolved
   * to an id first, so we only handle state and ZIP inline and skip otherwise.
   */
  function resolveGeoId(filters: SearchFilters): string | null {
    const geo = activeGeo(filters);
    if (!geo) return null;
    if (geo.type === "state") return geo.id.toUpperCase();
    if (geo.type === "zipcode") return geo.id;
    // city/county/jurisdiction ids must already be Shovels base64 handles.
    return /^[A-Za-z0-9_-]{8,}$/.test(geo.id) ? geo.id : null;
  }

  function mapPermit(p: ShovelsPermit): Permit {
    const addr = p.address ?? {};
    const street = [addr.street_no, addr.street].filter(Boolean).join(" ") || null;
    const description = p.description ?? p.description_derived ?? null;
    const tags = p.tags?.length ? p.tags : inferTags(description, p.type, p.subtype);

    return buildPermit({
      id: `shovels:${p.id}`,
      source_id: descriptor.id,
      stage: descriptor.stage ?? "issued",
      permit_number: p.number ?? null,
      status: p.status ? (SHOVELS_STATUS[p.status] ?? normalizeStatus(p.status)) : "unknown",
      status_raw: p.status ?? null,
      description,
      permit_type: p.type ?? p.subtype ?? null,
      tags: tags as Permit["tags"],
      address: street,
      geo: {
        state: addr.state ?? null,
        county: addr.county ?? null,
        city: addr.city ?? null,
        zipcode: addr.zip_code ?? null,
        jurisdiction: p.jurisdiction ?? addr.jurisdiction ?? null,
      },
      latitude: addr.latlng?.[0] ?? null,
      longitude: addr.latlng?.[1] ?? null,
      job_value: centsToDollars(p.job_value),
      fees: centsToDollars(p.fees),
      total_cost: null,
      file_date: p.file_date ?? null,
      issue_date: p.issue_date ?? null,
      final_date: p.final_date ?? null,
      contractor: null, // Shovels gives contractor_id only; hydrating costs extra credits.
      owner: p.property_legal_owner
        ? { name: null, company: p.property_legal_owner, license: null, phone: null, email: null, address: null }
        : null,
      property: {
        property_type: p.property_type ? (SHOVELS_PROPERTY_TYPE[p.property_type] ?? "other") : null,
        lot_size_sqft: p.property_lot_size ?? null,
        building_area_sqft: p.property_building_area ?? null,
        stories: p.property_story_count ?? null,
        units: p.property_unit_count ?? null,
        year_built: p.property_year_built ?? null,
        market_value: centsToDollars(p.property_assess_market_value),
      },
      source_fields: { ...p, contractor_id: p.contractor_id ?? null },
    });
  }

  function buildQuery(filters: SearchFilters, geoId: string, size: number): URLSearchParams {
    const params = new URLSearchParams();
    // All three are required by the API; default to a 12-month window.
    params.set("geo_id", geoId);
    params.set("permit_from", filters.permit_from ?? isoMonthsAgo(12));
    params.set("permit_to", filters.permit_to ?? new Date().toISOString().slice(0, 10));
    params.set("size", String(Math.min(size, 100)));
    params.set("include_count", "true");

    if (filters.permit_q) params.set("permit_q", filters.permit_q.slice(0, 50));
    // Exclusion is a "-" prefix inside permit_tags, not a separate parameter.
    for (const tag of filters.permit_tags ?? []) params.append("permit_tags", tag);
    for (const tag of filters.permit_tags_exclude ?? []) params.append("permit_tags", `-${tag}`);
    for (const status of filters.permit_status ?? []) params.append("permit_status", status);
    for (const pt of filters.property_type ?? []) params.append("property_type", pt);
    // Money filters are cents upstream.
    if (filters.permit_min_job_value) params.set("permit_min_job_value", String(filters.permit_min_job_value * 100));
    if (filters.permit_min_fees) params.set("permit_min_fees", String(filters.permit_min_fees * 100));
    if (filters.property_min_market_value) params.set("property_min_market_value", String(filters.property_min_market_value * 100));
    if (filters.property_min_building_area) params.set("property_min_building_area", String(filters.property_min_building_area));
    if (filters.property_min_lot_size) params.set("property_min_lot_size", String(filters.property_min_lot_size));
    if (filters.property_min_unit_count) params.set("property_min_unit_count", String(filters.property_min_unit_count));
    if (filters.contractor_name && filters.contractor_name.length >= 3) params.set("contractor_name", filters.contractor_name);
    if (filters.contractor_website) params.set("contractor_website", filters.contractor_website.replace(/^https?:\/\//, ""));
    return params;
  }

  return {
    descriptor,

    matches(filters: SearchFilters): boolean {
      if (!apiKey()) return false;
      return resolveGeoId(filters) != null;
    },

    async fetch({ filters, limit, signal }: FetchArgs): Promise<FetchResult> {
      const key = apiKey();
      if (!key) return { permits: [], warnings: ["Shovels: no API key configured"] };
      const geoId = resolveGeoId(filters);
      if (!geoId) return { permits: [], warnings: ["Shovels: needs a state, ZIP, or resolved geo id"] };

      const warnings: string[] = [];
      const permits: Permit[] = [];
      let cursor: string | null = null;
      let total: number | undefined;

      // Credits are charged per record returned, so never pull past what we need.
      const budget = Math.min(limit, 300);

      while (permits.length < budget) {
        const params = buildQuery(filters, geoId, Math.min(100, budget - permits.length));
        if (cursor) params.set("cursor", cursor);

        const page: ShovelsPage = await fetchJson<ShovelsPage>(`${BASE_URL}/permits/search?${params}`, {
          sourceId: descriptor.id, signal, timeoutMs: 25_000, headers: { "X-API-Key": key },
        });

        permits.push(...(page.items ?? []).map(mapPermit));
        if (page.total_count && total == null) total = page.total_count.value;
        cursor = page.next_cursor;
        if (!cursor || (page.items?.length ?? 0) === 0) break;
      }

      warnings.push(
        "Shovels data lags the permit record by a median of ~84 days; use a direct jurisdiction source for fresh filings.",
      );
      return { permits, total, warnings };
    },

    async probe() {
      const key = apiKey();
      if (!key) return { ok: false, detail: `no ${apiKeyEnv} configured` };
      try {
        const usage = await fetchJson<{ credits_used?: number; credit_limit?: number | null }>(
          `${BASE_URL}/usage`, { sourceId: descriptor.id, timeoutMs: 15_000, headers: { "X-API-Key": key } },
        );
        const limit = usage.credit_limit == null ? "unlimited" : String(usage.credit_limit);
        return { ok: true, detail: `ok, credits used ${usage.credits_used ?? 0} of ${limit}` };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

function isoMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}
