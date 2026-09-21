import { getContainer } from "@/lib/container";
import { authorize, fail, isFirstParty, ok } from "@/lib/api/respond";
import { activeGeo, parseFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/v1/permits/search
 *
 * The raw read path over every configured feed. Accepts the full filter
 * vocabulary; returns normalized permits plus the coverage report, so a caller
 * can tell "nothing matched" apart from "this county does not publish that
 * field".
 */
export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok && !isFirstParty(request)) return auth.response;

  const url = new URL(request.url);
  const parsed = parseFilters(url.searchParams);
  if (!parsed.ok) return fail("bad_request", parsed.error);

  if (!activeGeo(parsed.filters)) {
    return fail("bad_request", "Choose an area: pass geo_state, geo_county, geo_city or geo_zipcode.");
  }

  try {
    const result = await getContainer().search.search(parsed.filters, { signal: request.signal });
    const { items, ...rest } = result;
    return ok(items, rest);
  } catch (err) {
    return fail("upstream_failed", err instanceof Error ? err.message : "Search failed");
  }
}
