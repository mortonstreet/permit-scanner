import { getContainer } from "@/lib/container";
import { authorize, fail, isFirstParty, ok } from "@/lib/api/respond";
import type { Permit } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/v1/enrich  { permit_id } or { permit }
 *
 * Resolves the firm on a permit to a reachable decision maker. Costs provider
 * credits, so it only ever runs on explicit intent - never while rendering a
 * list. Callers may post the whole permit to avoid depending on server cache.
 */
export async function POST(request: Request) {
  const auth = authorize(request);
  if (!auth.ok && !isFirstParty(request)) return auth.response;

  let body: { permit_id?: string; permit?: Permit; credit_budget?: number };
  try {
    body = await request.json();
  } catch {
    return fail("bad_request", "Expected a JSON body with permit_id or permit.");
  }

  const c = getContainer();

  let permit: Permit | null = body.permit ?? null;
  if (permit) c.cache.put([permit]);
  else if (body.permit_id) permit = await c.search.getById(body.permit_id);

  if (!permit) return fail("not_found", "That permit is not loaded. Run the search again, then retry.");

  try {
    const result = await c.enrichment.enrich(permit, {
      creditBudget: body.credit_budget,
      signal: request.signal,
    });

    const providers = c.enrichment.configuredProviders();
    if (!result.contact && providers.length === 0) {
      return ok({
        ...result,
        notes: [
          ...result.notes,
          "No enrichment provider is configured. Set SHOVELS_API_KEY, CONTACTOUT_API_KEY or ROCKETREACH_API_KEY.",
        ],
      }, { providers_configured: providers });
    }
    return ok(result, { providers_configured: providers });
  } catch (err) {
    return fail("upstream_failed", err instanceof Error ? err.message : "Enrichment failed");
  }
}
