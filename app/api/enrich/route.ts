import { NextResponse } from "next/server";
import { cachePermits, getCachedPermit } from "@/lib/cache";
import { getPermitById } from "@/lib/supabase/permits";
import { configuredProviders, enrichPermit } from "@/lib/enrich";
import type { Permit } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/enrich  { permit_id } or { permit }
 *
 * Resolves the firm named on a permit to a reachable decision maker. Every
 * provider call costs credits, so this only ever runs on explicit user intent,
 * never while rendering a result list.
 *
 * Callers may post the whole permit rather than an id. The client already holds
 * it, and that avoids depending on a server-side cache that does not survive a
 * restart or a cold serverless instance.
 */
export async function POST(request: Request) {
  let body: { permit_id?: string; permit?: Permit };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with permit_id or permit." }, { status: 400 });
  }

  let permit: Permit | null = body.permit ?? null;
  if (permit) {
    // Keep it around so the detail page and a repeat reveal are both cheap.
    cachePermits([permit]);
  } else if (body.permit_id) {
    permit = getCachedPermit(body.permit_id) ?? (await getPermitById(body.permit_id));
  }

  if (!permit) {
    return NextResponse.json(
      { error: "That permit is not loaded. Run the search again, then retry." },
      { status: 404 },
    );
  }

  try {
    const result = await enrichPermit(permit, { signal: request.signal });

    if (!result.contact && configuredProviders().length === 0) {
      return NextResponse.json({
        ...result,
        notes: [
          ...result.notes,
          "No enrichment provider is configured. Set SHOVELS_API_KEY, CONTACTOUT_API_KEY or ROCKETREACH_API_KEY to resolve contacts beyond what the permit itself publishes.",
        ],
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enrichment failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
