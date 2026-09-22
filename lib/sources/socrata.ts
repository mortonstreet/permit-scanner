import type { SearchFilters } from "../filters";
import { buildPermit, inferTags, normalizePropertyType, normalizeStatus, parseDate, parseLatLng, parseMoney, titleCase } from "../normalize";
import { isOrganization, normalizePersonName, titleizeOrg } from "../names";
import { normalizePartyName } from "../normalize";
import type { Permit } from "../types";
import { type FetchArgs, type FetchResult, type SourceAdapter, type SourceDescriptor, fetchJson } from "./types";

/**
 * Generic adapter for Socrata (data.<city>.gov) permit datasets.
 *
 * Socrata speaks SoQL, so date ranges, text search, ordering and paging all push
 * down to the server. Each dataset names its columns differently, so a config
 * supplies the column mapping and the adapter does the rest.
 */

export interface SocrataFieldMap {
  permit_number: string;
  /** Prefer a single pre-joined address column; otherwise give the parts. */
  address?: string;
  address_parts?: { number?: string; street?: string };
  city?: string;
  zipcode?: string;
  county?: string;
  description?: string;
  permit_type?: string;
  status?: string;
  job_value?: string;
  fees?: string;
  /** The date the application entered the record - our freshness signal. */
  file_date?: string;
  issue_date?: string;
  final_date?: string;
  contractor_name?: string;
  contractor_company?: string;
  contractor_license?: string;
  contractor_phone?: string;
  owner_name?: string;
  property_type?: string;
  units?: string;
  year_built?: string;
  building_area?: string;
  latitude?: string;
  longitude?: string;
  /** A Socrata `point` column, used when lat/long are not separate columns. */
  location?: string;
}

export interface SocrataConfig {
  descriptor: Omit<SourceDescriptor, "platform">;
  /** Portal host, e.g. "data.cityofgainesville.org". */
  domain: string;
  /** The dataset's 4x4 identifier, e.g. "p798-uqu2". */
  datasetId: string;
  fields: SocrataFieldMap;
  /** Optional always-on SoQL predicate, e.g. to exclude a permit class. */
  baseWhere?: string;
  /** App token lifts the anonymous rate limit. Read from env at call time. */
  appTokenEnv?: string;
  /** Override when a dataset is large enough that aggregates are slow. */
  timeoutMs?: number;
}

type SocrataRow = Record<string, unknown>;

/** Escape a string literal for a SoQL `where` clause. */
function soqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** The date column the dataset's freshness is judged by. */
function dateColumn(fields: SocrataFieldMap): string | null {
  return fields.file_date ?? fields.issue_date ?? null;
}

export function createSocrataAdapter(config: SocrataConfig): SourceAdapter {
  const descriptor: SourceDescriptor = { ...config.descriptor, platform: "socrata" };
  const { domain, datasetId, fields } = config;
  const endpoint = `https://${domain}/resource/${datasetId}.json`;

  function headers(): Record<string, string> {
    const token = config.appTokenEnv ? process.env[config.appTokenEnv] : undefined;
    return token ? { "X-App-Token": token } : {};
  }

  function buildWhere(filters: SearchFilters): string[] {
    const clauses: string[] = [];
    if (config.baseWhere) clauses.push(`(${config.baseWhere})`);

    const dateCol = dateColumn(fields);
    if (dateCol) {
      if (filters.permit_from) clauses.push(`${dateCol} >= '${filters.permit_from}T00:00:00.000'`);
      if (filters.permit_to) clauses.push(`${dateCol} <= '${filters.permit_to}T23:59:59.999'`);
    }
    if (filters.permit_q && fields.description) {
      // upper() both sides: Socrata's `like` is case-sensitive.
      const needle = soqlString(`%${filters.permit_q.toUpperCase()}%`);
      const targets = [fields.description, fields.permit_type].filter(Boolean) as string[];
      clauses.push(`(${targets.map((c) => `upper(${c}) like ${needle}`).join(" or ")})`);
    }
    if (filters.permit_min_job_value && fields.job_value) {
      clauses.push(`${fields.job_value} >= ${filters.permit_min_job_value}`);
    }
    if (filters.geo_zipcode && fields.zipcode) {
      clauses.push(`${fields.zipcode} = ${soqlString(filters.geo_zipcode)}`);
    }
    return clauses;
  }

  function orderBy(filters: SearchFilters): string | null {
    const dateCol = dateColumn(fields);
    switch (filters.sort) {
      case "oldest": return dateCol ? `${dateCol} ASC` : null;
      case "value_desc": return fields.job_value ? `${fields.job_value} DESC` : null;
      case "value_asc": return fields.job_value ? `${fields.job_value} ASC` : null;
      default: return dateCol ? `${dateCol} DESC` : null;
    }
  }

  function str(row: SocrataRow, key?: string): string | null {
    if (!key) return null;
    const v = row[key];
    if (v == null) return null;
    // Socrata `location` columns arrive as objects.
    if (typeof v === "object") return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  }

  function num(row: SocrataRow, key?: string): number | null {
    const s = str(row, key);
    if (s == null) return null;
    const n = Number.parseFloat(s.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function mapRow(row: SocrataRow): Permit {
    const composed = [
      str(row, fields.address_parts?.number),
      titleCase(str(row, fields.address_parts?.street)),
    ].filter(Boolean).join(" ");
    const address = str(row, fields.address) ?? (composed === "" ? null : composed);

    const description = str(row, fields.description);
    const permitType = str(row, fields.permit_type);
    const statusRaw = str(row, fields.status);

    // Prefer explicit lat/long columns; fall back to a Socrata point object.
    let lat: unknown = str(row, fields.latitude);
    let lng: unknown = str(row, fields.longitude);
    if ((lat == null || lng == null) && fields.location) {
      const loc = row[fields.location] as { coordinates?: [number, number] } | undefined;
      if (loc?.coordinates) { lng = loc.coordinates[0]; lat = loc.coordinates[1]; }
    }

    // "TO BE BID" and friends mean no contractor, not a contractor called that.
    const contractorParty = normalizePartyName(str(row, fields.contractor_company));
    const contractorCompany = contractorParty.name;
    const contractorName = normalizePersonName({ full: str(row, fields.contractor_name) });
    const ownerName = normalizePersonName({ full: str(row, fields.owner_name) });

    return buildPermit({
      source_id: descriptor.id,
      stage: descriptor.stage ?? "issued",
      permit_number: str(row, fields.permit_number),
      status: normalizeStatus(statusRaw),
      status_raw: statusRaw,
      description,
      permit_type: permitType,
      tags: inferTags(description, permitType),
      address: titleCase(address),
      geo: {
        state: descriptor.state,
        county: str(row, fields.county) ?? descriptor.county ?? null,
        city: titleCase(str(row, fields.city)) ?? descriptor.city ?? null,
        zipcode: str(row, fields.zipcode),
        jurisdiction: descriptor.jurisdiction,
      },
      ...parseLatLng(lat, lng),
      job_value: parseMoney(str(row, fields.job_value)),
      fees: parseMoney(str(row, fields.fees)),
      total_cost: null,
      file_date: parseDate(str(row, fields.file_date)),
      issue_date: parseDate(str(row, fields.issue_date)),
      final_date: parseDate(str(row, fields.final_date)),
      contractor: contractorCompany || contractorName ? {
        name: contractorName,
        company: contractorCompany ? titleizeOrg(contractorCompany)
          : contractorName && isOrganization(contractorName) ? contractorName : null,
        license: str(row, fields.contractor_license),
        phone: str(row, fields.contractor_phone),
        email: null,
        address: null,
      } : null,
      owner: ownerName ? {
        name: ownerName,
        company: isOrganization(ownerName) ? ownerName : null,
        license: null, phone: null, email: null, address: null,
      } : null,
      property: {
        property_type: normalizePropertyType(str(row, fields.property_type) ?? permitType ?? description),
        lot_size_sqft: null,
        building_area_sqft: num(row, fields.building_area),
        stories: null,
        units: num(row, fields.units),
        year_built: num(row, fields.year_built),
        market_value: null,
      },
      contractor_unassigned: contractorParty.placeholder != null,
      source_fields: row,
    });
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
      const params = new URLSearchParams();
      const where = buildWhere(filters);
      if (where.length) params.set("$where", where.join(" and "));
      const order = orderBy(filters);
      if (order) params.set("$order", order);
      params.set("$limit", String(limit));

      if (filters.permit_q && !fields.description) {
        warnings.push(`${descriptor.label}: no description column, keyword filter applied locally`);
      }
      if (filters.permit_min_job_value && !fields.job_value) {
        warnings.push(`${descriptor.label}: no job value column, value filter applied locally`);
      }

      const rows = await fetchJson<SocrataRow[]>(`${endpoint}?${params}`, {
        sourceId: descriptor.id, signal, headers: headers(),
        timeoutMs: config.timeoutMs ?? 30_000,
      });

      return { permits: rows.map(mapRow), warnings };
    },

    async probe() {
      try {
        // Socrata omits null columns from row JSON, so a sample row cannot tell
        // us whether a mapped column exists. The view metadata can.
        const meta = await fetchJson<{ columns?: Array<{ fieldName?: string }> }>(
          `https://${domain}/api/views/${datasetId}.json`,
          { sourceId: descriptor.id, timeoutMs: 15_000, headers: headers() },
        );
        const columns = new Set((meta.columns ?? []).map((c) => c.fieldName).filter(Boolean) as string[]);
        const missing = Object.entries(fields)
          .filter(([, col]) => typeof col === "string" && columns.size > 0 && !columns.has(col))
          .map(([key, col]) => `${key}(${String(col)})`);

        // Freshness matters more than reachability: a dead dataset still 200s.
        let freshness = "";
        const dateCol = dateColumn(fields);
        if (dateCol) {
          const agg = await fetchJson<Array<Record<string, string>>>(
            `${endpoint}?${new URLSearchParams({ $select: `max(${dateCol}) as newest, count(*) as n` })}`,
            // A count over a million-row table is slow on a cold cache.
            { sourceId: descriptor.id, timeoutMs: config.timeoutMs ?? 45_000, headers: headers() },
          );
          const newest = agg[0]?.newest?.slice(0, 10);
          const count = agg[0]?.n;
          if (newest) {
            const ageDays = Math.floor((Date.now() - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000);
            freshness = `, newest ${newest} (${ageDays}d old), ${count ?? "?"} rows`;
          }
        }

        return {
          ok: true,
          detail: (missing.length ? `mapped columns not in schema: ${missing.join(", ")}` : "all mapped columns present") + freshness,
        };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
