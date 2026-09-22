import { createHash } from "node:crypto";
import type { Permit, PermitStatus, PermitTag, PropertyType } from "./types";

/**
 * Jurisdictions describe the same thing a hundred different ways. These mappers
 * collapse raw source text into the canonical enums. They are deliberately
 * conservative: anything unrecognized becomes "unknown"/"other" rather than being
 * force-fit, so the UI can show a dash instead of a confident wrong answer.
 */

const STATUS_PATTERNS: Array<[RegExp, PermitStatus]> = [
  [/\b(final|finaled|closed|completed|co issued|certificate of occupancy|passed)\b/i, "final"],
  [/\b(issued|active|open|in progress|under construction|permit issued)\b/i, "active"],
  [/\b(applied|application|in review|under review|pending|submitted|plan check|routing|intake)\b/i, "in_review"],
  [/\b(expired|void|voided|cancell?ed|withdrawn|denied|revoked|inactive|abandoned)\b/i, "inactive"],
];

export function normalizeStatus(raw: string | null | undefined): PermitStatus {
  if (!raw) return "unknown";
  for (const [pattern, status] of STATUS_PATTERNS) {
    if (pattern.test(raw)) return status;
  }
  return "unknown";
}

/**
 * Tag inference from the permit type + description.
 *
 * Order matters: excavation/sitework signals are checked before the generic
 * trades because an "EXCAVATION FOR NEW SFR" permit is an excavation lead first.
 */
const TAG_PATTERNS: Array<[RegExp, PermitTag]> = [
  [/\b(excavat\w*|trench\w*|earthwork|dig|boring|auger)\b/i, "excavation"],
  [/\b(site ?work|site development|site prep\w*|clearing and grubbing|land development)\b/i, "sitework"],
  [/\b(grad\w+|fill permit|earth ?moving|soil disturb\w*|erosion control)\b/i, "grading"],
  [/\b(demo|demolition|razing|teardown|tear[- ]down)\b/i, "demolition"],
  [/\b(foundation|footing|caisson|pil(e|ing)s?|slab on grade|stem wall)\b/i, "foundation"],
  [/\b(utilit\w+|water main|sewer|storm ?drain|force main|lift station|septic)\b/i, "utilities"],
  [/\b(paving|asphalt|parking lot|driveway|curb and gutter|sidewalk)\b/i, "paving"],
  [/\b(new construction|new building|new commercial|new residential|new sfr|ground up|groundup)\b/i, "new_construction"],
  [/\b(solar|photovoltaic|\bpv\b)\b/i, "solar"],
  [/\b(pool|spa)\b/i, "pool"],
  [/\b(adu|accessory dwelling)\b/i, "adu"],
  [/\b(window|door|fenestration)\b/i, "window_door"],
  [/\b(roof\w*|reroof|re-roof|shingle)\b/i, "roofing"],
  [/\b(electric\w*|\bpv\b|solar|panel upgrade|service change)\b/i, "electrical"],
  [/\b(plumb\w*|water heater|repipe|backflow)\b/i, "plumbing"],
  [/\b(mechanical|\bhvac\b|air condition\w*|furnace|ductwork|\bmep\b)\b/i, "mechanical"],
  [/\b(remodel|renovation|alteration|tenant improvement|\bti\b|addition|repair)\b/i, "remodel"],
  // Florida DEP environmental resource permits describe the same ground-disturbing
  // work in marine and stormwater language, so they need their own patterns.
  [/\b(dredg\w*|fill permit|shoreline stabiliz\w*|seawall|bulkhead|revetment|rip ?rap)\b/i, "excavation"],
  [/\b(stormwater|surface water management|retention pond|detention pond|outfall|swale)\b/i, "utilities"],
  [/\b(subaqua\w*|powerline crossing|directional bore|pipeline)\b/i, "utilities"],
  [/\b(plat|subdivision|commercial development|residential development|master site)\b/i, "sitework"],
  [/\b(mangrove|wetland|mitigation bank|environmental resource)\b/i, "sitework"],
  [/\b(dock|boathouse|boat ?lift|boardwalk|pier|marina|slip)\b/i, "foundation"],
];

export function inferTags(...texts: Array<string | null | undefined>): PermitTag[] {
  const haystack = texts.filter(Boolean).join(" ");
  if (!haystack.trim()) return [];
  const tags = new Set<PermitTag>();
  for (const [pattern, tag] of TAG_PATTERNS) {
    if (pattern.test(haystack)) tags.add(tag);
  }
  return [...tags];
}

const PROPERTY_TYPE_PATTERNS: Array<[RegExp, PropertyType]> = [
  [/\b(single family|sfr|duplex|triplex|townhome|townhouse|condo|apartment|multi[- ]?family|residential|dwelling)\b/i, "residential"],
  [/\b(industrial|warehouse|manufactur\w*|distribution|logistics)\b/i, "industrial"],
  [/\b(mixed[- ]use)\b/i, "mixed"],
  [/\b(commercial|retail|office|restaurant|hotel|business)\b/i, "commercial"],
];

export function normalizePropertyType(raw: string | null | undefined): PropertyType | null {
  if (!raw) return null;
  for (const [pattern, type] of PROPERTY_TYPE_PATTERNS) {
    if (pattern.test(raw)) return type;
  }
  return null;
}

/** Parse money that arrives as "$1,250,000.00", "1250000", 1250000, or junk. */
export function parseMoney(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Coerce the many date shapes sources emit into YYYY-MM-DD, or null. */
export function parseDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  // Epoch milliseconds - ArcGIS returns these for date fields.
  if (typeof raw === "number") {
    const d = new Date(raw > 1e11 ? raw : raw * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // US-style M/D/YYYY.
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Title-case a SCREAMING ADDRESS while leaving directionals and state codes alone. */
const KEEP_UPPER = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "NB", "SB", "EB", "WB", "US", "SR", "FL", "TX", "PO"]);

export function titleCase(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;
  // Already mixed case - leave it as the jurisdiction wrote it.
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s
    .split(" ")
    .map((word) => {
      const bare = word.replace(/[^A-Za-z]/g, "");
      if (KEEP_UPPER.has(bare.toUpperCase()) && bare.length <= 2) return word.toUpperCase();
      if (/^\d/.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Placeholder values jurisdictions write where a party is not yet known.
 *
 * Phoenix literally writes "TO BE BID" in the professional-of-record field to
 * mean the contractor has not been selected - which is the strongest
 * pre-award signal we have. Treating it as a contractor name would invert its
 * meaning and mark the job as already placed.
 */
const PARTY_PLACEHOLDERS = [
  /^to\s*be\s*(bid|determined|selected|assigned|hired|announced)$/i,
  /^(tbd|tba|t\.b\.d\.?|n\/?a|none|unknown|not\s*applicable|pending|owner)$/i,
  /^(self|homeowner|owner\s*builder|owner[-\s]*occupant)$/i,
  /^(no\s*contractor|contractor\s*unknown|same\s*as\s*owner)$/i,
  /^[-.\s*]+$/,
];

/**
 * Null out a party name that is really a placeholder.
 *
 * Returns the reason when it strips one, so a caller can record that the
 * absence was explicit rather than merely missing - "the jurisdiction says no
 * contractor yet" is a stronger signal than "this feed has no such column".
 */
export function normalizePartyName(raw: string | null | undefined): { name: string | null; placeholder: string | null } {
  if (!raw) return { name: null, placeholder: null };
  const trimmed = String(raw).trim();
  if (!trimmed) return { name: null, placeholder: null };
  if (PARTY_PLACEHOLDERS.some((re) => re.test(trimmed))) {
    return { name: null, placeholder: trimmed.toUpperCase() };
  }
  return { name: trimmed, placeholder: null };
}

/** Deterministic id so re-ingesting the same record updates instead of duplicating. */
export function permitId(sourceId: string, permitNumber: string | null, address: string | null): string {
  const basis = `${sourceId}:${(permitNumber ?? "").toUpperCase()}:${(address ?? "").toUpperCase()}`;
  return createHash("sha1").update(basis).digest("hex").slice(0, 16);
}

/** Sanity-clamp latitude/longitude; sources routinely emit 0,0 or swapped pairs. */
export function parseLatLng(lat: unknown, lng: unknown): { latitude: number | null; longitude: number | null } {
  const a = typeof lat === "number" ? lat : Number.parseFloat(String(lat ?? ""));
  const b = typeof lng === "number" ? lng : Number.parseFloat(String(lng ?? ""));
  const validLat = Number.isFinite(a) && Math.abs(a) <= 90 && a !== 0;
  const validLng = Number.isFinite(b) && Math.abs(b) <= 180 && b !== 0;
  if (!validLat || !validLng) return { latitude: null, longitude: null };
  return { latitude: a, longitude: b };
}

/** Build a canonical Permit from partial mapped fields, filling every gap with null. */
export function buildPermit(input: Partial<Permit> & Pick<Permit, "source_id">): Permit {
  const permit_number = input.permit_number ?? null;
  const address = input.address ?? null;
  return {
    id: input.id ?? permitId(input.source_id, permit_number, address),
    source_id: input.source_id,
    permit_number,
    status: input.status ?? "unknown",
    status_raw: input.status_raw ?? null,
    description: input.description ?? null,
    permit_type: input.permit_type ?? null,
    tags: input.tags ?? [],
    address,
    geo: input.geo ?? { state: null, county: null, city: null, zipcode: null, jurisdiction: null },
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    job_value: input.job_value ?? null,
    fees: input.fees ?? null,
    total_cost: input.total_cost ?? null,
    file_date: input.file_date ?? null,
    issue_date: input.issue_date ?? null,
    final_date: input.final_date ?? null,
    contractor: input.contractor ?? null,
    owner: input.owner ?? null,
    contractor_unassigned: input.contractor_unassigned ?? false,
    property: input.property ?? {
      property_type: null, lot_size_sqft: null, building_area_sqft: null,
      stories: null, units: null, year_built: null, market_value: null,
    },
    source_fields: input.source_fields ?? {},
    ingested_at: input.ingested_at ?? new Date().toISOString(),
  };
}
