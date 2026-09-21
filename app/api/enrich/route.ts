import { NextResponse } from "next/server";
import { getContainer } from "@/lib/container";
import type { Permit } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/enrich - first-party alias of /api/v1/enrich. */
export async function POST(request: Request) {
  let body: { permit_id?: string; permit?: Permit };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with permit_id or permit." }, { status: 400 });
  }

  const c = getContainer();
  let permit: Permit | null = body.permit ?? null;
  if (permit) c.cache.put([permit]);
  else if (body.permit_id) permit = await c.search.getById(body.permit_id);

  if (!permit) {
    return NextResponse.json(
      { error: "That permit is not loaded. Run the search again, then retry." },
      { status: 404 },
    );
  }

  try {
    const result = await c.enrichment.enrich(permit, { signal: request.signal });
    if (!result.contact && c.enrichment.configuredProviders().length === 0) {
      return NextResponse.json({
        ...result,
        notes: [
          ...result.notes,
          "No enrichment provider is configured. Set SHOVELS_API_KEY, CONTACTOUT_API_KEY or ROCKETREACH_API_KEY.",
        ],
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Enrichment failed" },
      { status: 502 },
    );
  }
}
