import { NextResponse } from "next/server";
import { cachePermits, getCachedPermit } from "@/lib/cache";
import { getPermitById } from "@/lib/supabase/permits";
import { parseFilters } from "@/lib/filters";
import { aggregateSearch } from "@/lib/sources/aggregate";
import { ALL_SOURCES } from "@/lib/sources/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * GET /api/permits/:id[?<original search query>]
 *
 * Resolution order: the in-process cache, then Supabase, then - if the caller
 * passed the search that produced the row - a re-run of that search.
 *
 * The third path matters because the cache is per-process and the upstream
 * sources have no by-id endpoint. Without it a shared detail link would break
 * on the next deploy or server restart.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const cached = getCachedPermit(id);
  if (cached) return NextResponse.json(cached);

  const stored = await getPermitById(id);
  if (stored) return NextResponse.json(stored);

  const url = new URL(request.url);
  const parsed = parseFilters(url.searchParams);
  const hasGeo = parsed.ok && (
    parsed.filters.geo_state || parsed.filters.geo_county || parsed.filters.geo_city ||
    parsed.filters.geo_zipcode || parsed.filters.geo_jurisdiction
  );

  if (parsed.ok && hasGeo) {
    // Pull a wide slice of the original search and look for this row in it.
    const result = await aggregateSearch({
      filters: { ...parsed.filters, page: 1, size: 100 },
      adapters: ALL_SOURCES,
      signal: request.signal,
    });
    cachePermits(result.items);
    const match = result.items.find((p) => p.id === id);
    if (match) return NextResponse.json(match);
  }

  return NextResponse.json(
    {
      error: hasGeo
        ? "That permit is no longer in the source's recent window. Run the search again to reload it."
        : "That permit is not loaded. Open it from a search so the filters travel with the link.",
    },
    { status: 404 },
  );
}
