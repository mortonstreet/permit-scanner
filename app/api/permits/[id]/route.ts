import { NextResponse } from "next/server";
import { getContainer } from "@/lib/container";
import { parseFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/** GET /api/permits/:id - first-party alias of /api/v1/permits/:id. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const parsed = parseFilters(url.searchParams);

  try {
    const permit = await getContainer().search.getById(
      id, parsed.ok ? parsed.filters : undefined, request.signal,
    );
    if (!permit) {
      return NextResponse.json(
        { error: "That permit is not loaded. Run the search again to reload it." },
        { status: 404 },
      );
    }
    return NextResponse.json(permit);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      { status: 502 },
    );
  }
}
