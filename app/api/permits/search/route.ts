import { NextResponse } from "next/server";
import { getContainer } from "@/lib/container";
import { activeGeo, parseFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/permits/search
 *
 * Kept as the first-party UI's endpoint; /api/v1/permits/search is the public,
 * versioned surface. Both resolve through the same container, so there is one
 * code path and no chance of the two drifting.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseFilters(url.searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  if (!activeGeo(parsed.filters)) {
    return NextResponse.json(
      { error: "Choose a state, county, city or ZIP before searching." },
      { status: 400 },
    );
  }

  try {
    const result = await getContainer().search.search(parsed.filters, { signal: request.signal });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 502 },
    );
  }
}
