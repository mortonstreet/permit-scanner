import { competingContractor, isActionableForGc, resolveTarget, scoreBand, scoreLead } from "./lead";
import { freshnessLabel } from "./sources/aggregate";
import type { Permit } from "./types";

/**
 * A Signal is a permit turned into a sales action: who to call, why now, and
 * how good the lead is relative to everything else on the list.
 */

export interface Signal {
  permit_id: string;
  /**
   * Other permits the same firm filed in this window. A developer pulling five
   * permits is one phone call, not five, and the cluster is itself a buying
   * signal - it says they are actively building, not doing a one-off.
   */
  also_filed?: Array<{ permit_id: string; address: string | null; value: number | null; posted: string }>;
  score: number;
  band: "hot" | "warm" | "cool";
  reasons: string[];
  stage: "pre_permit" | "pre_issuance" | "issued";
  days_old: number | null;
  posted: string;
  target: { name: string; role: string; why: string; is_company: boolean } | null;
  /** The contractor already on the job. Non-null means someone else won it. */
  competing_contractor: string | null;
  /** True when no contractor of record is on the filing - still winnable. */
  open: boolean;
  /** Reasons this lead is weaker than its score suggests. */
  warnings: string[];
  contact_on_permit: { phone: string | null; email: string | null };
  job: { description: string | null; permit_type: string | null; tags: string[]; value: number | null };
  where: {
    address: string | null; city: string | null; county: string | null;
    state: string | null; jurisdiction: string | null;
    latitude: number | null; longitude: number | null;
  };
  permit_number: string | null;
  source: string;
}

export function buildSignal(permit: Permit, now: Date): Signal {
  const s = scoreLead(permit, now);
  const target = resolveTarget(permit);

  return {
    permit_id: permit.id,
    score: s.score,
    band: scoreBand(s.score),
    reasons: s.reasons,
    stage: s.prePermit ? "pre_permit" : s.preIssuance ? "pre_issuance" : "issued",
    days_old: s.daysOld,
    posted: freshnessLabel(permit, now),
    target: target
      ? { name: target.name, role: target.role, why: target.reason, is_company: target.isCompany }
      : null,
    competing_contractor: competingContractor(permit),
    open: s.open,
    warnings: s.warnings,
    contact_on_permit: {
      phone: permit.contractor?.phone ?? permit.owner?.phone ?? null,
      email: permit.contractor?.email ?? permit.owner?.email ?? null,
    },
    job: {
      description: permit.description,
      permit_type: permit.permit_type,
      tags: permit.tags,
      value: permit.job_value,
    },
    where: {
      address: permit.address,
      city: permit.geo.city,
      county: permit.geo.county,
      state: permit.geo.state,
      jurisdiction: permit.geo.jurisdiction,
      latitude: permit.latitude,
      longitude: permit.longitude,
    },
    permit_number: permit.permit_number,
    source: permit.source_id,
  };
}

export interface SignalQuery {
  windowDays: number;
  minScore: number;
  stage: "all" | "pre_permit" | "pre_issuance";
  limit: number;
  /** Drop permits that already name a contractor. Default view for a GC. */
  openOnly: boolean;
}

/**
 * Filter to GC-actionable, score, drop below the floor, cluster by firm, rank.
 *
 * Clustering matters for the product, not just the display: the unit of work
 * for a salesperson is a conversation with a firm, and five permits from one
 * developer is one conversation with a stronger opening.
 */
export function rankSignals(permits: Permit[], now: Date, q: SignalQuery): Signal[] {
  const scored = permits
    .filter(isActionableForGc)
    .map((p) => buildSignal(p, now))
    .filter((s) => (q.openOnly ? s.open : true))
    .filter((s) => s.score >= q.minScore)
    .filter((s) =>
      q.stage === "all" ||
      (q.stage === "pre_permit" && s.stage === "pre_permit") ||
      (q.stage === "pre_issuance" && s.stage !== "issued"));

  // Group by firm, keeping the highest-scoring permit as the one to lead with.
  const byFirm = new Map<string, Signal[]>();
  for (const s of scored) {
    const key = s.target ? firmClusterKey(s.target.name) : s.permit_id;
    const bucket = byFirm.get(key);
    if (bucket) bucket.push(s);
    else byFirm.set(key, [s]);
  }

  const clustered: Signal[] = [];
  for (const group of byFirm.values()) {
    group.sort((a, b) => b.score - a.score || (b.job.value ?? 0) - (a.job.value ?? 0));
    const [lead, ...rest] = group;
    clustered.push({
      ...lead,
      // A firm filing repeatedly is worth a nudge up the list, capped so it
      // cannot outrank genuine freshness.
      score: Math.min(100, lead.score + Math.min(rest.length * 2, 6)),
      also_filed: rest.slice(0, 5).map((s) => ({
        permit_id: s.permit_id,
        address: s.where.address,
        value: s.job.value,
        posted: s.posted,
      })),
    });
  }

  return clustered.sort((a, b) => b.score - a.score || (a.days_old ?? 999) - (b.days_old ?? 999));
}

/** Loose firm key: lowercase, strip punctuation and legal suffixes. */
function firmClusterKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'"()]/g, " ")
    .replace(/\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|lp|llp|pa|pllc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
