import { getContainer } from "@/lib/container";
import { authorize, fail, isFirstParty, ok } from "@/lib/api/respond";
import { resolveEntityFully } from "@/lib/enrich/resolve";
import { entityDbStats } from "@/lib/enrich/gov/sunbiz";
import { resolveTarget } from "@/lib/lead";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/v1/resolve?company=...&city=...&license=...
 * GET /api/v1/resolve?permit_id=...
 * GET /api/v1/resolve            -> entity database stats
 *
 * Full entity resolution: every Florida public source is consulted and the
 * results merged, with the origin and confidence recorded per field.
 */
export async function GET(request: Request) {
  const auth = authorize(request);
  if (!auth.ok && !isFirstParty(request)) return auth.response;

  const params = new URL(request.url).searchParams;
  const company = params.get("company");
  const permitId = params.get("permit_id");

  try {
    if (permitId) {
      const permit = await getContainer().search.getById(permitId);
      if (!permit) return fail("not_found", "That permit is not loaded. Run the search again.");
      const target = resolveTarget(permit);
      if (!target) return fail("bad_request", "That permit names no party to resolve.");

      const result = await resolveEntityFully(target.name, {
        city: permit.geo.city,
        state: permit.geo.state,
        licenseNumber: permit.contractor?.license ?? null,
      });
      return ok(result, { permit_id: permitId, target_role: target.role });
    }

    if (company) {
      const result = await resolveEntityFully(company, {
        city: params.get("city"),
        state: params.get("state") ?? "FL",
        licenseNumber: params.get("license"),
      });
      return ok(result);
    }

    return ok({ entity_db: entityDbStats() });
  } catch (err) {
    return fail("upstream_failed", err instanceof Error ? err.message : "Resolution failed");
  }
}
