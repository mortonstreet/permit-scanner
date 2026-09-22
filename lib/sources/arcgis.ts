import type { SearchFilters } from "../filters";
import { buildPermit, inferTags, normalizePropertyType, normalizeStatus, parseDate, parseLatLng, parseMoney, titleCase } from "../normalize";
import { isOrganization, normalizePersonName, titleizeOrg } from "../names";
import { normalizePartyName } from "../normalize";
import type { Permit } from "../types";
import { type FetchArgs, type FetchResult, type SourceAdapter, type SourceDescriptor, fetchJson } from "./types";

/**
 * Generic adapter for ArcGIS FeatureServer / MapServer permit layers.
 *
 * Most US counties publish permits this way. The query API takes a SQL-92 `where`
 * clause, returns attributes plus optional geometry, and reports dates as epoch
 * milliseconds. Counting is a separate cheap call (returnCountOnly=true).
 */

export interface ArcGisFieldMap {
  permit_number: string;
  address?: string;
  city?: string;
  zipcode?: string;
  county?: string;
  description?: string;
  permit_type?: string;
  status?: string;
  job_value?: string;
  fees?: string;
  file_date?: string;
  issue_date?: string;
  final_date?: string;
  contractor_name?: string;
  contractor_company?: string;
  contractor_license?: string;
  contractor_phone?: string;
  owner_name?: string;
  owner_company?: string;
  /** Some feeds split the applicant across two columns (Manatee, Accela). */
  owner_first_name?: string;
  owner_last_name?: string;
  contractor_first_name?: string;
  contractor_last_name?: string;
  property_type?: string;
  units?: string;
  year_built?: string;
  building_area?: string;
}

export interface ArcGisConfig {
  descriptor: Omit<SourceDescriptor, "platform">;
  /** Full layer URL ending in the layer index, e.g. ".../FeatureServer/0". */
  layerUrl: string;
  fields: ArcGisFieldMap;
  baseWhere?: string;
  /** ArcGIS caps page size per service; 1000 or 2000 are typical. */
  maxRecordCount?: number;
  /** Override when a server is unusually slow. Defaults to 45s. */
  timeoutMs?: number;
  /**
   * Some services store dates as plain strings rather than esriFieldTypeDate
   * (Manatee's APPLYDATE, St. Johns' IssueDate). `DATE '...'` and INTERVAL
   * both 400 against those, so we compare against a quoted literal instead.
   */
  dateAsString?: boolean;
}

interface ArcGisFeature {
  attributes: Record<string, unknown>;
  geometry?: { x?: number; y?: number };
}

interface ArcGisResponse {
  features?: ArcGisFeature[];
  count?: number;
  exceededTransferLimit?: boolean;
  error?: { code: number; message: string; details?: string[] };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** ArcGIS wants dates as `DATE 'YYYY-MM-DD'` in a where clause. */
function sqlDate(iso: string): string {
  return `DATE '${iso}'`;
}

export function createArcGisAdapter(config: ArcGisConfig): SourceAdapter {
  const descriptor: SourceDescriptor = { ...config.descriptor, platform: "arcgis" };
  const { layerUrl, fields } = config;
  const queryUrl = `${layerUrl.replace(/\/+$/, "")}/query`;

  const dateCol = fields.file_date ?? fields.issue_date ?? null;

  function buildWhere(filters: SearchFilters): string {
    const clauses: string[] = [];
    if (config.baseWhere) clauses.push(`(${config.baseWhere})`);
    if (dateCol) {
      const asLiteral = (iso: string) => (config.dateAsString ? sqlString(iso) : sqlDate(iso));
      if (filters.permit_from) clauses.push(`${dateCol} >= ${asLiteral(filters.permit_from)}`);
      if (filters.permit_to) clauses.push(`${dateCol} <= ${asLiteral(filters.permit_to)}`);
    }
    if (filters.permit_q && fields.description) {
      const needle = sqlString(`%${filters.permit_q.toUpperCase()}%`);
      const targets = [fields.description, fields.permit_type].filter(Boolean) as string[];
      clauses.push(`(${targets.map((c) => `UPPER(${c}) LIKE ${needle}`).join(" OR ")})`);
    }
    if (filters.permit_min_job_value && fields.job_value) {
      clauses.push(`${fields.job_value} >= ${filters.permit_min_job_value}`);
    }
    if (filters.geo_zipcode && fields.zipcode) {
      clauses.push(`${fields.zipcode} = ${sqlString(filters.geo_zipcode)}`);
    }
    return clauses.length ? clauses.join(" AND ") : "1=1";
  }

  function orderBy(filters: SearchFilters): string | null {
    switch (filters.sort) {
      case "oldest": return dateCol ? `${dateCol} ASC` : null;
      case "value_desc": return fields.job_value ? `${fields.job_value} DESC` : null;
      case "value_asc": return fields.job_value ? `${fields.job_value} ASC` : null;
      default: return dateCol ? `${dateCol} DESC` : null;
    }
  }

  function str(attrs: Record<string, unknown>, key?: string): string | null {
    if (!key) return null;
    const v = attrs[key];
    if (v == null) return null;
    const s = String(v).trim();
    return s === "" || s.toUpperCase() === "NULL" ? null : s;
  }

  function num(attrs: Record<string, unknown>, key?: string): number | null {
    const s = str(attrs, key);
    if (s == null) return null;
    const n = Number.parseFloat(s.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function mapFeature(feature: ArcGisFeature): Permit {
    const a = feature.attributes ?? {};
    const description = str(a, fields.description);
    const permitType = str(a, fields.permit_type);
    const statusRaw = str(a, fields.status);
    // "TO BE BID" and friends mean no contractor, not a contractor called that.
    const contractorParty = normalizePartyName(str(a, fields.contractor_company));
    const contractorCompany = contractorParty.name;
    // Prefer split columns when the feed has them; they are unambiguous.
    const contractorName = normalizePersonName({
      first: str(a, fields.contractor_first_name),
      last: str(a, fields.contractor_last_name),
      full: str(a, fields.contractor_name),
    });
    const ownerCompany = str(a, fields.owner_company);
    const ownerName = normalizePersonName({
      first: str(a, fields.owner_first_name),
      last: str(a, fields.owner_last_name),
      full: str(a, fields.owner_name),
    });

    return buildPermit({
      source_id: descriptor.id,
      permit_number: str(a, fields.permit_number),
      status: normalizeStatus(statusRaw),
      status_raw: statusRaw,
      description,
      permit_type: permitType,
      tags: inferTags(description, permitType),
      address: titleCase(str(a, fields.address)),
      geo: {
        state: descriptor.state,
        county: str(a, fields.county) ?? descriptor.county ?? null,
        city: titleCase(str(a, fields.city)) ?? descriptor.city ?? null,
        zipcode: str(a, fields.zipcode),
        jurisdiction: descriptor.jurisdiction,
      },
      // ArcGIS geometry is x=longitude, y=latitude.
      ...parseLatLng(feature.geometry?.y, feature.geometry?.x),
      job_value: parseMoney(str(a, fields.job_value)),
      fees: parseMoney(str(a, fields.fees)),
      total_cost: null,
      file_date: parseDate(a[fields.file_date ?? ""] ?? null),
      issue_date: parseDate(a[fields.issue_date ?? ""] ?? null),
      final_date: parseDate(a[fields.final_date ?? ""] ?? null),
      contractor: contractorCompany || contractorName ? {
        name: contractorName,
        // A person's name is not a company name; only promote it when it
        // actually reads like an entity.
        company: contractorCompany ? titleizeOrg(contractorCompany)
          : contractorName && isOrganization(contractorName) ? contractorName : null,
        license: str(a, fields.contractor_license),
        phone: str(a, fields.contractor_phone),
        email: null, address: null,
      } : null,
      // Prefer the filing company; fall back to the individual applicant, since
      // many filings are made by an owner-operator under their own name.
      owner: ownerCompany || ownerName ? {
        name: ownerName,
        company: ownerCompany ? titleizeOrg(ownerCompany)
          : ownerName && isOrganization(ownerName) ? ownerName : null,
        license: null, phone: null, email: null, address: null,
      } : null,
      property: {
        property_type: normalizePropertyType(str(a, fields.property_type) ?? permitType ?? description),
        lot_size_sqft: null,
        building_area_sqft: num(a, fields.building_area),
        stories: null,
        units: num(a, fields.units),
        year_built: num(a, fields.year_built),
        market_value: null,
      },
      contractor_unassigned: contractorParty.placeholder != null,
      source_fields: a,
    });
  }

  async function query(params: Record<string, string>, signal?: AbortSignal): Promise<ArcGisResponse> {
    const search = new URLSearchParams({ f: "json", ...params });
    const res = await fetchJson<ArcGisResponse>(`${queryUrl}?${search}`, {
      // Some on-prem servers (Phoenix) are slow on a cold cache; a short
      // timeout drops an otherwise healthy source.
      sourceId: descriptor.id, signal, timeoutMs: config.timeoutMs ?? 45_000,
    });
    // ArcGIS reports failures with HTTP 200 and an `error` body.
    if (res.error) {
      throw new Error(`ArcGIS error ${res.error.code}: ${res.error.message} ${res.error.details?.join("; ") ?? ""}`);
    }
    return res;
  }

  return {
    descriptor,

    matches(filters: SearchFilters): boolean {
      if (filters.geo_state && filters.geo_state !== descriptor.state) return false;
      if (filters.geo_county && descriptor.county &&
          filters.geo_county.toUpperCase() !== descriptor.county.toUpperCase()) return false;
      if (filters.geo_city && descriptor.city &&
          filters.geo_city.toUpperCase() !== descriptor.city.toUpperCase()) return false;
      if (filters.geo_jurisdiction &&
          filters.geo_jurisdiction.toUpperCase() !== descriptor.jurisdiction.toUpperCase()) return false;
      return true;
    },

    async fetch({ filters, limit, signal }: FetchArgs): Promise<FetchResult> {
      const warnings: string[] = [];
      const where = buildWhere(filters);
      const cap = Math.min(limit, config.maxRecordCount ?? 1000);

      const params: Record<string, string> = {
        where,
        outFields: "*",
        returnGeometry: "true",
        outSR: "4326",
        resultRecordCount: String(cap),
      };
      const order = orderBy(filters);
      if (order) params.orderByFields = order;

      const res = await query(params, signal);
      if (res.exceededTransferLimit) {
        warnings.push(`${descriptor.label}: hit the layer's transfer limit, results truncated`);
      }
      if (filters.permit_q && !fields.description) {
        warnings.push(`${descriptor.label}: no description field, keyword filter applied locally`);
      }

      let total: number | undefined;
      try {
        const countRes = await query({ where, returnCountOnly: "true" }, signal);
        total = countRes.count;
      } catch {
        // Counting is a nicety; a failure here must not fail the search.
      }

      return { permits: (res.features ?? []).map(mapFeature), total, warnings };
    },

    async probe() {
      try {
        const res = await query({ where: "1=1", outFields: "*", resultRecordCount: "1", returnGeometry: "false" });
        const sample = res.features?.[0]?.attributes;
        if (!sample) return { ok: false, detail: "layer returned 0 features" };

        const missing = Object.entries(fields)
          .filter(([, col]) => typeof col === "string" && !(col in sample))
          .map(([key, col]) => `${key}(${String(col)})`);

        // A frozen feed still answers 200, so report how stale it is.
        let freshness = "";
        if (dateCol) {
          try {
            const stats = await query({
              where: `${dateCol} IS NOT NULL`,
              outFields: dateCol,
              orderByFields: `${dateCol} DESC`,
              resultRecordCount: "1",
              returnGeometry: "false",
            });
            const raw = stats.features?.[0]?.attributes?.[dateCol];
            const newest = parseDate(raw);
            if (newest) {
              const ageDays = Math.floor((Date.now() - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000);
              freshness = `, newest ${newest} (${ageDays}d old)`;
            }
          } catch {
            // Freshness is diagnostic only; never fail the probe over it.
          }
          try {
            const countRes = await query({ where: "1=1", returnCountOnly: "true" });
            if (countRes.count != null) freshness += `, ${countRes.count.toLocaleString()} rows`;
          } catch { /* ignore */ }
        }

        return {
          ok: true,
          rows: res.features?.length ?? 0,
          detail: (missing.length ? `mapped fields absent: ${missing.join(", ")}` : "all mapped fields present") + freshness,
        };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
