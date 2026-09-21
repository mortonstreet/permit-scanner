import { isActionableForGc, resolveDeveloper, resolveTarget, scoreBand, scoreLead } from "./lead";
import { freshnessLabel } from "./sources/aggregate";
import type { Permit } from "./types";

/**
 * A Signal is a permit turned into a sales action: who to call, why now, and
 * how good the lead is relative to everything else on the list.
 */

export interface Signal {
  permit_id: string;
  score: number;
  band: "hot" | "warm" | "cool";
  reasons: string[];
  stage: "pre_permit" | "pre_issuance" | "issued";
  days_old: number | null;
  posted: string;
  target: { name: string; role: string; why: string } | null;
  developer: string | null;
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
    target: target ? { name: target.name, role: target.role, why: target.reason } : null,
    developer: resolveDeveloper(permit),
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
}

/** Filter to GC-actionable, score, drop below the floor, rank. */
export function rankSignals(permits: Permit[], now: Date, q: SignalQuery): Signal[] {
  return permits
    .filter(isActionableForGc)
    .map((p) => buildSignal(p, now))
    .filter((s) => s.score >= q.minScore)
    .filter((s) =>
      q.stage === "all" ||
      (q.stage === "pre_permit" && s.stage === "pre_permit") ||
      (q.stage === "pre_issuance" && s.stage !== "issued"))
    .sort((a, b) => b.score - a.score || (a.days_old ?? 999) - (b.days_old ?? 999));
}
