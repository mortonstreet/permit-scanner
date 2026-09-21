import { daysSincePosted, type Permit } from "./types";

/**
 * Lead model: who a general contractor actually wants to reach, and how good
 * the lead is.
 *
 * The buyer is the GC. On a permit the GC is the `contractor` of record - the
 * party who will subcontract excavation and site work. The `owner` is the
 * developer, who matters earlier in the cycle and on permits the GC pulls
 * themselves. We surface both and target the GC first.
 */

export type TargetRole = "gc" | "developer" | "applicant";

export interface LeadTarget {
  name: string;
  role: TargetRole;
  /** Why this party was chosen, shown in the UI so the pick is never opaque. */
  reason: string;
}

/**
 * Pick the party to sell to.
 *
 * Contractor first: they hold the subcontracting budget. Fall back to the owner
 * when no contractor is named, which is common on owner-builder filings and on
 * the pre-permit environmental layer.
 */
export function resolveTarget(permit: Permit): LeadTarget | null {
  const gc = permit.contractor?.company ?? permit.contractor?.name ?? null;
  const owner = permit.owner?.company ?? permit.owner?.name ?? null;

  if (gc && owner && gc.toUpperCase() !== owner.toUpperCase()) {
    return { name: gc, role: "gc", reason: "Contractor of record - holds the subcontract budget" };
  }
  if (gc) return { name: gc, role: "gc", reason: "Contractor of record" };
  if (owner) {
    return { name: owner, role: "developer", reason: "No contractor named; owner is the buying party" };
  }
  return null;
}

/** The developer behind the job, when it differs from the GC. */
export function resolveDeveloper(permit: Permit): string | null {
  const gc = permit.contractor?.company ?? permit.contractor?.name ?? null;
  const owner = permit.owner?.company ?? permit.owner?.name ?? null;
  if (!owner) return null;
  if (gc && gc.toUpperCase() === owner.toUpperCase()) return null;
  return owner;
}

/* ─────────────────────────────── scoring ─────────────────────────────── */

/** Work types a site-work or excavation contractor can actually bid. */
export const SITEWORK_TAGS = new Set([
  "excavation", "sitework", "grading", "demolition",
  "foundation", "utilities", "paving", "new_construction",
]);

export interface LeadScore {
  /** 0-100. Higher means a better use of a salesperson's next hour. */
  score: number;
  /** Plain-English drivers, shown as chips so the number is never a black box. */
  reasons: string[];
  /** True when the job has not been issued yet - the window is still open. */
  preIssuance: boolean;
  /** True when this is an environmental or site-plan filing, ahead of any build permit. */
  prePermit: boolean;
  daysOld: number | null;
}

/**
 * Score a permit as a sales lead for a site-work GC.
 *
 * The weighting reflects what actually decides whether a call converts:
 * freshness first (a 30-day-old permit is already spoken for), then whether the
 * job is still pre-issuance, then whether there is anyone to call, then size.
 */
export function scoreLead(permit: Permit, now = new Date()): LeadScore {
  const reasons: string[] = [];
  let score = 0;

  const daysOld = daysSincePosted(permit, now);
  const preIssuance = permit.issue_date == null && permit.final_date == null;
  const prePermit = permit.source_id === "fl-fdep-erp" || permit.source_id === "fl-hillsborough-sitedev";

  // ── freshness, 0-35 ──────────────────────────────────────────────────
  if (daysOld == null) {
    score += 5;
  } else if (daysOld <= 1) {
    score += 35; reasons.push("Filed in the last 24h");
  } else if (daysOld <= 3) {
    score += 30; reasons.push(`Filed ${daysOld}d ago`);
  } else if (daysOld <= 7) {
    score += 22; reasons.push("Filed this week");
  } else if (daysOld <= 14) {
    score += 12;
  } else if (daysOld <= 30) {
    score += 5;
  }

  // ── stage, 0-25 ──────────────────────────────────────────────────────
  if (prePermit) {
    score += 25;
    reasons.push("Pre-permit filing - ahead of the building permit");
  } else if (preIssuance) {
    score += 18;
    reasons.push("Not yet issued - work has not started");
  }

  // ── reachability, 0-20 ───────────────────────────────────────────────
  const target = resolveTarget(permit);
  if (target?.role === "gc") {
    score += 20; reasons.push("Names the contractor of record");
  } else if (target) {
    score += 10; reasons.push("Names the owner");
  }
  if (permit.contractor?.phone) { score += 5; reasons.push("Phone on the permit"); }

  // ── fit, 0-20 ────────────────────────────────────────────────────────
  const siteworkTags = permit.tags.filter((t) => SITEWORK_TAGS.has(t));
  if (siteworkTags.length > 0) {
    score += 14;
    reasons.push(siteworkTags.includes("excavation") || siteworkTags.includes("sitework")
      ? "Excavation / site work"
      : "Site-work adjacent");
  }
  if (permit.tags.includes("new_construction")) { score += 6; reasons.push("Ground-up build"); }

  // ── size, 0-15 ───────────────────────────────────────────────────────
  const value = permit.job_value;
  if (value != null) {
    if (value >= 5_000_000) { score += 15; reasons.push("$5M+ job"); }
    else if (value >= 1_000_000) { score += 12; reasons.push("$1M+ job"); }
    else if (value >= 250_000) { score += 8; }
    else if (value >= 50_000) { score += 4; }
  }

  return {
    score: Math.min(Math.round(score), 100),
    reasons,
    preIssuance,
    prePermit,
    daysOld,
  };
}

/** Bucket for the UI badge. */
export function scoreBand(score: number): "hot" | "warm" | "cool" {
  if (score >= 70) return "hot";
  if (score >= 45) return "warm";
  return "cool";
}

/**
 * A permit only belongs on a GC's call list if there is work they can bid and
 * somebody they can call about it.
 */
export function isActionableForGc(permit: Permit): boolean {
  const hasWork = permit.tags.some((t) => SITEWORK_TAGS.has(t));
  const hasTarget = resolveTarget(permit) != null;
  return hasWork && hasTarget;
}
