import { getContainer } from "@/lib/container";
import { authorize, fail, isFirstParty, ok } from "@/lib/api/respond";
import { parseFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * GET /api/v1/permits/:id
 *
 * Any query string is treated as the search that produced the row, and is used
 * to re-hydrate it if the cache has been cleared - the upstream feeds have no
 * by-id endpoint, so without that a shared link breaks on the next deploy.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorize(request);
  if (!auth.ok && !isFirstParty(request)) return auth.response;

  const { id } = await params;
  const url = new URL(request.url);
  const parsed = parseFilters(url.searchParams);
  const filters = parsed.ok ? parsed.filters : undefined;

  try {
    const permit = await getContainer().search.getById(id, filters, request.signal);
    if (!permit) {
      return fail("not_found", filters
        ? "That permit is no longer in the source's recent window. Run the search again."
        : "That permit is not loaded. Open it from a search so the filters travel with the link.");
    }
    return ok(permit);
  } catch (err) {
    return fail("upstream_failed", err instanceof Error ? err.message : "Lookup failed");
  }
}
