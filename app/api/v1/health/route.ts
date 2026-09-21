import { getContainer } from "@/lib/container";
import { ok } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/** GET /api/v1/health - what is wired up, for deploy checks and the status page. */
export async function GET() {
  const c = getContainer();
  const sources = c.catalog.all();

  return ok({
    status: "ok",
    sources: {
      total: sources.length,
      live: sources.filter((s) => !c.catalog.isArchival(s.descriptor.id)).length,
      archival: sources.filter((s) => c.catalog.isArchival(s.descriptor.id)).length,
      needing_credentials: sources
        .filter((s) => s.descriptor.requiresCredential && !process.env[s.descriptor.requiresCredential])
        .map((s) => s.descriptor.id),
    },
    states_covered: [...new Set(
      sources.filter((s) => !c.catalog.isArchival(s.descriptor.id) && s.descriptor.state !== "*")
        .map((s) => s.descriptor.state),
    )].sort(),
    storage: { supabase: c.store.available() },
    enrichment: { providers: c.enrichment.configuredProviders() },
    cache: { permits: c.cache.size() },
  });
}
