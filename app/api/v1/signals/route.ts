import { getContainer } from "@/lib/container";
import { authorize, fail, isFirstParty, ok } from "@/lib/api/respond";
import { parseFilters, type SearchFilters } from "@/lib/filters";
import { isActionableForGc, isOpenOpportunity } from "@/lib/lead";
import { rankSignals } from "@/lib/signal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/v1/signals
 *
 * The product surface. Everything else in this API describes permits; this
 * endpoint answers the only question a general contractor actually has:
 * "who should I call today, and why?"
 *
 * It differs from /permits/search in three ways:
 *   1. It only returns permits a site-work GC can bid AND reach someone about.
 *   2. It scores and ranks them by how worth a phone call they are right now.
 *   3. It names the target party and the reason, so the call has an opening.
 *
 * Extra params beyond the standard filter vocabulary:
 *   window      days back to look (default 7, max 90)
 *   min_score   drop leads below this score (default 40)
 *   stage       all | early | entitlement | pre_permit | pre_issuance (default all)
 *               "early" means everything ahead of permit issuance
 *   open_only   exclude permits that already name a contractor (default true)
 */
export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok && !isFirstParty(request)) return auth.response;

  const url = new URL(request.url);
  const params = url.searchParams;

  const window = clamp(Number.parseInt(params.get("window") ?? "7", 10) || 7, 1, 90);
  const minScore = clamp(Number.parseInt(params.get("min_score") ?? "40", 10) || 0, 0, 100);
  const stage = params.get("stage") ?? "all";
  // Default to open jobs only: a permit that already names a contractor is a
  // lagging indicator, and selling it to a GC wastes their call.
  const openOnly = (params.get("open_only") ?? "true") !== "false";
  const limit = clamp(Number.parseInt(params.get("limit") ?? "50", 10) || 50, 1, 200);

  // Default the date range from `window` unless the caller set one explicitly.
  if (!params.get("permit_from")) params.set("permit_from", isoDaysAgo(window));
  if (!params.get("permit_to")) params.set("permit_to", isoToday());
  params.delete("page");

  const parsed = parseFilters(params);
  if (!parsed.ok) return fail("bad_request", parsed.error);

  const filters: SearchFilters = parsed.filters;
  if (!filters.geo_state && !filters.geo_county && !filters.geo_city &&
      !filters.geo_zipcode && !filters.geo_jurisdiction) {
    return fail("bad_request", "Choose an area: pass geo_state, geo_county, geo_city or geo_zipcode.");
  }

  const c = getContainer();

  try {
    // Score the whole candidate set, not one page - ranking a slice ranks nothing.
    const result = await c.search.search(filters, { signal: request.signal, poolSize: 1500 });
    const now = c.clock.now();

    const scored = rankSignals(result.items, now, {
      windowDays: window,
      minScore,
      stage: stage as "all" | "early" | "entitlement" | "pre_permit" | "pre_issuance",
      limit,
      openOnly,
    });

    const signals = scored.slice(0, limit);

    return ok(signals, {
      window_days: window,
      min_score: minScore,
      stage,
      open_only: openOnly,
      scanned: result.items.length,
      actionable: scored.length,
      returned: signals.length,
      // Honest about why most rows were dropped.
      funnel: {
        permits_scanned: result.items.length,
        gc_actionable: result.items.filter(isActionableForGc).length,
        open_jobs: result.items.filter(isOpenOpportunity).length,
        above_min_score: scored.length,
      },
      sources: result.sources.filter((s) => !s.archival).map((s) => s.label),
      warnings: result.warnings,
    });
  } catch (err) {
    return fail("upstream_failed", err instanceof Error ? err.message : "Signal query failed");
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
