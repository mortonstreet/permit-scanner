/**
 * Canonical permit model.
 *
 * Every ingestion source (Socrata, ArcGIS, Apify, Shovels) normalizes into this
 * shape so the UI and the enrichment pipeline never care where a record came from.
 * Field names follow the Shovels vocabulary where one exists, so that swapping in
 * their API later is a source adapter change and nothing else.
 */

export type PermitStatus = "final" | "active" | "in_review" | "inactive" | "unknown";

export type PropertyType = "residential" | "commercial" | "industrial" | "mixed" | "other";

/** Trade/work-type tags, mirroring the Shovels tag taxonomy we care about. */
export type PermitTag =
  | "new_construction"
  | "excavation"
  | "sitework"
  | "grading"
  | "demolition"
  | "foundation"
  | "utilities"
  | "paving"
  | "electrical"
  | "plumbing"
  | "mechanical"
  | "roofing"
  | "solar"
  | "pool"
  | "adu"
  | "window_door"
  | "remodel"
  | "other";

export interface GeoRef {
  /** Two-letter state code, e.g. "FL". */
  state: string | null;
  county: string | null;
  city: string | null;
  zipcode: string | null;
  /** The permitting authority (city/county building dept) that issued it. */
  jurisdiction: string | null;
}

export interface PermitContact {
  name: string | null;
  company: string | null;
  license: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface PropertyInfo {
  property_type: PropertyType | null;
  lot_size_sqft: number | null;
  building_area_sqft: number | null;
  stories: number | null;
  units: number | null;
  year_built: number | null;
  market_value: number | null;
}

export interface Permit {
  /** Stable hash id: sha1(source_id + ":" + permit_number + ":" + address). */
  id: string;
  /** Registry key of the source adapter that produced this row. */
  source_id: string;

  permit_number: string | null;
  status: PermitStatus;
  /** Raw status string as the jurisdiction reported it, kept for auditing. */
  status_raw: string | null;

  description: string | null;
  permit_type: string | null;
  tags: PermitTag[];

  address: string | null;
  geo: GeoRef;
  latitude: number | null;
  longitude: number | null;

  /** Declared construction value in whole dollars. */
  job_value: number | null;
  fees: number | null;
  total_cost: number | null;

  /** ISO-8601 dates (YYYY-MM-DD). */
  file_date: string | null;
  issue_date: string | null;
  final_date: string | null;

  /** The firm doing the work, as named on the permit. */
  contractor: PermitContact | null;
  /** The developer/property owner - the party we ultimately want to reach. */
  owner: PermitContact | null;

  /**
   * The jurisdiction explicitly stated no contractor is engaged yet - Phoenix
   * writes "TO BE BID" in the professional-of-record field. This is stronger
   * than a null: an absent column means the feed does not publish contractors,
   * whereas this means the work is genuinely out to bid.
   */
  contractor_unassigned: boolean;

  property: PropertyInfo;

  /** Everything the source gave us that we did not map, for the "source fields" drawer. */
  source_fields: Record<string, unknown>;
  /** When our ingestion worker first saw this record. */
  ingested_at: string;
}

/** Days elapsed since the permit entered the public record. */
export function daysSincePosted(permit: Pick<Permit, "file_date" | "issue_date">, now = new Date()): number | null {
  const basis = permit.file_date ?? permit.issue_date;
  if (!basis) return null;
  const then = Date.parse(`${basis}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  return days < 0 ? 0 : days;
}

export interface SearchResponse {
  items: Permit[];
  total: number;
  /** True when `total` is a floor rather than an exact count (source caps counting). */
  total_is_estimate: boolean;
  page: number;
  size: number;
  /** Per-source notes, e.g. a jurisdiction that timed out, so the UI can be honest. */
  warnings: string[];
}
