import { z } from "zod";

/**
 * Search filter vocabulary.
 *
 * Param names are taken verbatim from the app.shovels.ai client bundle so that
 * URLs are interchangeable with theirs and a Shovels source adapter needs no
 * translation layer.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Comma-separated list in the URL -> string[] in code. */
const csv = z
  .string()
  .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean))
  .pipe(z.array(z.string()));

export const permitStatusEnum = z.enum(["final", "active", "in_review", "inactive"]);

export const searchFiltersSchema = z.object({
  // --- geography (at most one of these narrows the search) ---
  geo_state: z.string().length(2).toUpperCase().optional(),
  geo_county: z.string().optional(),
  geo_city: z.string().optional(),
  geo_zipcode: z.string().regex(/^\d{5}$/).optional(),
  geo_jurisdiction: z.string().optional(),
  /** Human-readable labels the UI round-trips through the URL for chip display. */
  geo_state_label: z.string().optional(),
  geo_county_label: z.string().optional(),
  geo_city_label: z.string().optional(),
  geo_jurisdiction_label: z.string().optional(),

  // --- dates ---
  permit_from: isoDate.optional(),
  permit_to: isoDate.optional(),

  // --- permit attributes ---
  permit_q: z.string().max(200).optional(),
  permit_status: csv.pipe(z.array(permitStatusEnum)).optional(),
  permit_tags: csv.optional(),
  permit_tags_exclude: csv.optional(),
  permit_min_job_value: z.coerce.number().nonnegative().optional(),
  permit_max_job_value: z.coerce.number().nonnegative().optional(),
  permit_min_fees: z.coerce.number().nonnegative().optional(),

  // --- contractor ---
  contractor_id: z.string().optional(),
  contractor_name: z.string().optional(),
  contractor_website: z.string().optional(),

  // --- property ---
  property_type: csv.optional(),
  property_min_market_value: z.coerce.number().nonnegative().optional(),
  property_max_market_value: z.coerce.number().nonnegative().optional(),
  property_min_lot_size: z.coerce.number().nonnegative().optional(),
  property_max_lot_size: z.coerce.number().nonnegative().optional(),
  property_min_building_area: z.coerce.number().nonnegative().optional(),
  property_max_building_area: z.coerce.number().nonnegative().optional(),
  property_min_unit_count: z.coerce.number().nonnegative().optional(),
  property_max_unit_count: z.coerce.number().nonnegative().optional(),
  property_min_year_built: z.coerce.number().int().optional(),
  property_max_year_built: z.coerce.number().int().optional(),
  legal_owner: z.string().optional(),

  // --- result shaping ---
  sort: z.enum(["newest", "oldest", "value_desc", "value_asc"]).default("newest"),
  size: z.coerce.number().int().min(1).max(100).default(15),
  page: z.coerce.number().int().min(1).default(1),
  tab: z.enum(["permits", "contractors", "properties"]).default("permits"),
});

export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export type SearchFiltersInput = z.input<typeof searchFiltersSchema>;

/** Parse a URLSearchParams (or plain record) into validated filters. */
export function parseFilters(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): { ok: true; filters: SearchFilters } | { ok: false; error: string } {
  const raw: Record<string, string> = {};
  if (input instanceof URLSearchParams) {
    for (const [k, v] of input.entries()) if (v !== "") raw[k] = v;
  } else {
    for (const [k, v] of Object.entries(input)) {
      const val = Array.isArray(v) ? v[0] : v;
      if (val != null && val !== "") raw[k] = val;
    }
  }
  const parsed = searchFiltersSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `${first.path.join(".") || "query"}: ${first.message}` };
  }
  // A backwards date range silently returns nothing, so reject it loudly instead.
  const { permit_from, permit_to } = parsed.data;
  if (permit_from && permit_to && permit_from > permit_to) {
    return { ok: false, error: "permit_from must be on or before permit_to" };
  }
  return { ok: true, filters: parsed.data };
}

/** Serialize filters back to a URL query string, omitting defaults and blanks. */
export function filtersToQuery(filters: Partial<SearchFilters>): string {
  const params = new URLSearchParams();
  const defaults: Record<string, unknown> = { sort: "newest", size: 15, page: 1, tab: "permits" };
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      params.set(key, value.join(","));
      continue;
    }
    if (defaults[key] !== undefined && defaults[key] === value) continue;
    params.set(key, String(value));
  }
  params.sort();
  return params.toString();
}

/** Which geography the user narrowed to, if any. Used to pick source adapters. */
export function activeGeo(f: SearchFilters):
  | { type: "state" | "county" | "city" | "zipcode" | "jurisdiction"; id: string; label: string }
  | null {
  if (f.geo_jurisdiction) return { type: "jurisdiction", id: f.geo_jurisdiction, label: f.geo_jurisdiction_label ?? f.geo_jurisdiction };
  if (f.geo_city) return { type: "city", id: f.geo_city, label: f.geo_city_label ?? f.geo_city };
  if (f.geo_zipcode) return { type: "zipcode", id: f.geo_zipcode, label: f.geo_zipcode };
  if (f.geo_county) return { type: "county", id: f.geo_county, label: f.geo_county_label ?? f.geo_county };
  if (f.geo_state) return { type: "state", id: f.geo_state, label: f.geo_state_label ?? f.geo_state };
  return null;
}

/** Chips shown in the "Active filters" bar. `key` is what an X button clears. */
export function activeFilterChips(f: SearchFilters): Array<{ key: keyof SearchFilters; label: string }> {
  const chips: Array<{ key: keyof SearchFilters; label: string }> = [];
  const geo = activeGeo(f);
  if (geo) {
    const nice = { state: "State", county: "County", city: "City", zipcode: "Zip", jurisdiction: "Jurisdiction" }[geo.type];
    chips.push({ key: `geo_${geo.type}` as keyof SearchFilters, label: `${nice}: ${geo.label}` });
  }
  if (f.permit_from) chips.push({ key: "permit_from", label: `Issued after ${fmtUS(f.permit_from)}` });
  if (f.permit_to) chips.push({ key: "permit_to", label: `Issued before ${fmtUS(f.permit_to)}` });
  if (f.permit_q) chips.push({ key: "permit_q", label: `Keyword: ${f.permit_q}` });
  if (f.permit_status?.length) chips.push({ key: "permit_status", label: `Status: ${f.permit_status.join(", ")}` });
  if (f.permit_tags?.length) chips.push({ key: "permit_tags", label: `Tags: ${f.permit_tags.join(", ")}` });
  if (f.permit_min_job_value) chips.push({ key: "permit_min_job_value", label: `Job value >= ${usd(f.permit_min_job_value)}` });
  if (f.contractor_name) chips.push({ key: "contractor_name", label: `Contractor: ${f.contractor_name}` });
  if (f.legal_owner) chips.push({ key: "legal_owner", label: `Owner: ${f.legal_owner}` });
  return chips;
}

function fmtUS(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
