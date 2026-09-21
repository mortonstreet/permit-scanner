import { getContainer } from "@/lib/container";
import { ok } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/** GET /api/v1/sources - the feed registry, with freshness expectations. */
export async function GET() {
  const c = getContainer();
  return ok(
    c.catalog.all().map((a) => ({
      ...a.descriptor,
      archival: c.catalog.isArchival(a.descriptor.id),
      configured: a.descriptor.requiresCredential
        ? Boolean(process.env[a.descriptor.requiresCredential])
        : true,
    })),
  );
}
