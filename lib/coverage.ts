import type { Permit } from "./types";

/**
 * Field-coverage reporting.
 *
 * Public permit data is wildly inconsistent: one county fills in job value on
 * every record, the next leaves it blank. Filtering on a sparsely-reported field
 * silently hides most of the data, so we measure how often each field is actually
 * populated in the current result scope and surface that next to the filter.
 * This is the same idea as the reference app's "36% report this" warning.
 */

export type CoverageField =
  | "issue_date" | "file_date" | "description" | "job_value" | "fees"
  | "tags" | "property_type" | "contractor" | "owner" | "address" | "latlng";

export interface CoverageReport {
  /** Fraction 0..1 of sampled permits that populate each field. */
  fields: Partial<Record<CoverageField, number>>;
  /** How many records the fractions were computed from. */
  sampled: number;
  /** Scope the sample came from, for the banner copy. */
  scopeLabel: string;
}

const PRESENCE: Record<CoverageField, (p: Permit) => boolean> = {
  issue_date: (p) => p.issue_date != null,
  file_date: (p) => p.file_date != null,
  description: (p) => Boolean(p.description?.trim()),
  job_value: (p) => p.job_value != null && p.job_value > 0,
  fees: (p) => p.fees != null && p.fees > 0,
  tags: (p) => p.tags.length > 0,
  property_type: (p) => p.property.property_type != null,
  contractor: (p) => Boolean(p.contractor?.company ?? p.contractor?.name),
  owner: (p) => Boolean(p.owner?.company ?? p.owner?.name),
  address: (p) => Boolean(p.address?.trim()),
  latlng: (p) => p.latitude != null && p.longitude != null,
};

export function computeCoverage(permits: Permit[], scopeLabel: string): CoverageReport {
  const sampled = permits.length;
  if (sampled === 0) return { fields: {}, sampled: 0, scopeLabel };

  const fields: Partial<Record<CoverageField, number>> = {};
  for (const [field, present] of Object.entries(PRESENCE) as Array<[CoverageField, (p: Permit) => boolean]>) {
    let hits = 0;
    for (const permit of permits) if (present(permit)) hits += 1;
    fields[field] = hits / sampled;
  }
  return { fields, sampled, scopeLabel };
}

export interface CoverageWarning {
  field: CoverageField;
  label: string;
  pct: number;
  /** Copy for the amber banner, e.g. "36% report this, up to ~64% may be missing". */
  message: string;
}

const FIELD_LABELS: Record<CoverageField, string> = {
  issue_date: "Date range",
  file_date: "Filed date",
  description: "Description keywords",
  job_value: "Job value",
  fees: "Fees",
  tags: "Included categories",
  property_type: "Property type",
  contractor: "Contractor",
  owner: "Property owner",
  address: "Address",
  latlng: "Map location",
};

/**
 * Only warn about fields the user is actually filtering on - an unreported field
 * nobody asked about is not a problem worth an amber banner.
 */
export function coverageWarnings(
  report: CoverageReport,
  fieldsInUse: CoverageField[],
  threshold = 0.9,
): CoverageWarning[] {
  const warnings: CoverageWarning[] = [];
  for (const field of fieldsInUse) {
    const pct = report.fields[field];
    if (pct == null || pct >= threshold) continue;
    const reported = Math.round(pct * 100);
    const missing = 100 - reported;
    warnings.push({
      field,
      label: FIELD_LABELS[field],
      pct,
      message: reported === 0
        ? "almost no permits report this field here"
        : `${reported}% report this, up to ~${missing}% may be missing`,
    });
  }
  return warnings;
}

/** Map the active filters to the coverage fields they depend on. */
export function fieldsUsedByFilters(params: URLSearchParams): CoverageField[] {
  const used: CoverageField[] = [];
  if (params.get("permit_from") || params.get("permit_to")) used.push("issue_date");
  if (params.get("permit_q")) used.push("description");
  if (params.get("permit_tags") || params.get("permit_tags_exclude")) used.push("tags");
  if (params.get("permit_min_job_value") || params.get("permit_max_job_value")) used.push("job_value");
  if (params.get("permit_min_fees")) used.push("fees");
  if (params.get("property_type")) used.push("property_type");
  if (params.get("contractor_name") || params.get("contractor_class")) used.push("contractor");
  if (params.get("legal_owner")) used.push("owner");
  return used;
}
