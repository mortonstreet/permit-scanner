import { NextResponse } from "next/server";
import { ALL_SOURCES, ARCHIVAL_SOURCE_IDS } from "@/lib/sources/registry";

/** GET /api/sources - what the app can currently pull from, and how fresh it is. */
export async function GET() {
  return NextResponse.json({
    sources: ALL_SOURCES.map((a) => ({
      ...a.descriptor,
      archival: ARCHIVAL_SOURCE_IDS.has(a.descriptor.id),
      configured: a.descriptor.requiresCredential
        ? Boolean(process.env[a.descriptor.requiresCredential])
        : true,
    })),
  });
}
