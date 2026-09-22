import { isOrganization } from "./names";
import { daysSincePosted, type Permit } from "./types";

/**
 * Lead model.
 *
 * The buyer is a general contractor looking for work they can still win. That
 * single fact drives everything here:
 *
 *   A permit that already names a contractor of record is a LAGGING indicator.
 *   Someone else won that job. It is near-worthless as a lead.
 *
 *   A permit that names a developer or owner and NO contractor is the prize.
 *   The work is real, the money is committed, and the trade package is open.
 *
 * So the target we sell is the developer, and the strongest signal is the
 * absence of a competitor on the filing.
 */

export type TargetRole = "developer" | "owner_builder" | "gc";

export interface LeadTarget {
  name: string;
  role: TargetRole;
  /** Why this party, shown in the UI so the pick is never opaque. */
  reason: string;
  /** True when the named party looks like a company rather than an individual. */
  isCompany: boolean;
}

/** Is there already a contractor of record, i.e. has someone else won this? */
export function hasCompetingContractor(permit: Permit): boolean {
  const gc = permit.contractor?.company ?? permit.contractor?.name ?? null;
  if (!gc) return false;
  const owner = permit.owner?.company ?? permit.owner?.name ?? null;
  // An owner-builder filing under their own name is not a competitor.
  if (owner && gc.toUpperCase() === owner.toUpperCase()) return false;
  return true;
}

/**
 * Pick the party to sell to: the developer or owner who controls the job.
 *
 * We only fall back to the contractor when there is no owner at all, and we
 * label it honestly so the UI can show it as the weak lead it is.
 */
export function resolveTarget(permit: Permit): LeadTarget | null {
  const owner = permit.owner?.company ?? permit.owner?.name ?? null;
  const gc = permit.contractor?.company ?? permit.contractor?.name ?? null;

  if (owner) {
    const competing = hasCompetingContractor(permit);
    return {
      name: owner,
      role: competing ? "developer" : "owner_builder",
      reason: competing
        ? "Developer on the filing - a contractor is already engaged"
        : "Developer on the filing, no contractor of record yet",
      isCompany: isOrganization(owner),
    };
  }
  if (gc) {
    return {
      name: gc,
      role: "gc",
      reason: "Only a contractor is named - this job is already placed",
      isCompany: isOrganization(gc),
    };
  }
  return null;
}

/** The contractor already on the job, if any. Shown as a competitive warning. */
export function competingContractor(permit: Permit): string | null {
  if (!hasCompetingContractor(permit)) return null;
  return permit.contractor?.company ?? permit.contractor?.name ?? null;
}

/* ─────────────────────────────── scoring ─────────────────────────────── */

export const SITEWORK_TAGS = new Set([
  "excavation", "sitework", "grading", "demolition",
  "foundation", "utilities", "paving", "new_construction",
]);

export interface LeadScore {
  score: number;
  reasons: string[];
  /** Things that count against the lead, surfaced rather than buried. */
  warnings: string[];
  preIssuance: boolean;
  prePermit: boolean;
  /** True when no contractor of record is on the filing - the job is open. */
  open: boolean;
  daysOld: number | null;
}

/**
 * Score a permit as a lead for a GC chasing site work.
 *
 * Weighting, highest first:
 *   openness   35  no contractor named -> the trade package is still winnable
 *   freshness  30  a 30-day-old filing is already being quoted
 *   stage      15  pre-permit and pre-issuance mean the window is open
 *   fit        12  work this contractor can actually bid
 *   size        8  bigger jobs justify the drive
 * and a hard penalty when a competitor already holds the job.
 */
export function scoreLead(permit: Permit, now = new Date()): LeadScore {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  const daysOld = daysSincePosted(permit, now);
  const preIssuance = permit.issue_date == null && permit.final_date == null;
  const prePermit = permit.stage === "pre_permit" || permit.stage === "entitlement";
  const competitor = competingContractor(permit);
  const open = competitor == null;
  const target = resolveTarget(permit);

  // ── openness: the single most important signal, 0-35 ────────────────
  if (permit.contractor_unassigned) {
    // The jurisdiction said it outright rather than us inferring it from a
    // null, so this outranks a merely-absent contractor.
    score += 38;
    reasons.push("Out to bid - contractor not selected");
  } else if (open && target) {
    score += 35;
    reasons.push("No contractor of record yet");
  } else if (competitor) {
    // Not zero: a GC on a big job still subcontracts site work. But this is a
    // lagging lead and must never outrank an open one.
    score += 4;
    warnings.push(`${competitor} already has this job`);
  }

  // ── freshness, 0-30 ─────────────────────────────────────────────────
  if (daysOld == null) score += 4;
  else if (daysOld <= 1) { score += 30; reasons.push("Filed in the last 24h"); }
  else if (daysOld <= 3) { score += 25; reasons.push(`Filed ${daysOld}d ago`); }
  else if (daysOld <= 7) { score += 18; reasons.push("Filed this week"); }
  else if (daysOld <= 14) score += 10;
  else if (daysOld <= 30) score += 4;

  /*
   * Stage, 0-22. This carries more weight than it looks.
   *
   * Measured windows: entitlement runs ~170 days from site plan submission to
   * approval, while permit review is 28 days in Raleigh and 2 days in Orlando.
   * An issued permit in a fast-permitting city is not a lead at all - the
   * contractor was engaged before the permit existed.
   */
  if (permit.stage === "entitlement") {
    score += 22;
    reasons.push("Entitlement stage - months before a building permit");
  } else if (permit.stage === "pre_permit") {
    score += 18;
    reasons.push("Pre-permit filing - ahead of the building permit");
  } else if (preIssuance) {
    score += 10;
    reasons.push("Not yet issued - work has not started");
  }

  /*
   * Staleness guard.
   *
   * Jurisdictions rarely close out abandoned applications: Raleigh has 952
   * plans still marked in-review with a median age of eleven years. An old
   * open record is a dead project, not a patient one, and it must not ride
   * the stage bonus onto a call list.
   */
  if (daysOld != null && daysOld > 365 && preIssuance) {
    score -= 25;
    warnings.push(`Open for ${Math.floor(daysOld / 365)}y - likely abandoned, not pending`);
  } else if (daysOld != null && daysOld > 180 && preIssuance) {
    score -= 10;
    warnings.push("Open more than 6 months with no movement");
  }

  // ── fit, 0-12 ───────────────────────────────────────────────────────
  const siteworkTags = permit.tags.filter((t) => SITEWORK_TAGS.has(t));
  if (siteworkTags.length > 0) {
    score += 8;
    reasons.push(
      siteworkTags.includes("excavation") || siteworkTags.includes("sitework") || siteworkTags.includes("grading")
        ? "Excavation / site work"
        : "Site-work adjacent",
    );
  }
  if (permit.tags.includes("new_construction")) { score += 4; reasons.push("Ground-up build"); }

  // ── size, 0-8 ───────────────────────────────────────────────────────
  const value = permit.job_value;
  if (value != null) {
    if (value >= 5_000_000) { score += 8; reasons.push("$5M+ job"); }
    else if (value >= 1_000_000) { score += 6; reasons.push("$1M+ job"); }
    else if (value >= 250_000) { score += 4; }
    else if (value >= 50_000) { score += 2; }
  }

  // ── reachability bonus, capped ──────────────────────────────────────
  if (permit.owner?.email || permit.contractor?.email) {
    score += 8;
    reasons.push("Direct email on the filing");
  }
  if (permit.owner?.phone || permit.contractor?.phone) {
    score += 6;
    reasons.push("Phone on the filing");
  }
  // A company is a far better enrichment target than a private individual.
  if (target?.isCompany) score += 3;
  else if (target) warnings.push("Applicant is an individual, not a company");
  else if (permit.contractor_unassigned) warnings.push("No party named - the permit record is the only lead");

  return {
    score: Math.min(Math.round(score), 100),
    reasons, warnings, preIssuance, prePermit, open, daysOld,
  };
}

export function scoreBand(score: number): "hot" | "warm" | "cool" {
  if (score >= 70) return "hot";
  if (score >= 45) return "warm";
  return "cool";
}

/**
 * A permit belongs on the list if there is biddable work and either somebody
 * to call or an explicit statement that the work is out to bid.
 *
 * The second case matters: Phoenix names no owner but writes "TO BE BID" on
 * open grading permits. There is no contact, but the job, the address and the
 * scope are all known and the trade package is provably unlet - which is a
 * better lead than a named party on a job somebody already won.
 */
export function isActionableForGc(permit: Permit): boolean {
  const hasWork = permit.tags.some((t) => SITEWORK_TAGS.has(t));
  if (!hasWork) return false;
  return resolveTarget(permit) != null || permit.contractor_unassigned;
}

/** Only jobs nobody has won yet. The default view for a GC hunting work. */
export function isOpenOpportunity(permit: Permit): boolean {
  return isActionableForGc(permit) && !hasCompetingContractor(permit);
}
