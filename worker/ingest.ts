import "dotenv/config";
import { searchFiltersSchema } from "../lib/filters";
import { ALL_SOURCES, ARCHIVAL_SOURCE_IDS } from "../lib/sources/registry";
import { finishIngestRun, registerSource, startIngestRun, upsertPermits } from "../lib/supabase/permits";
import { isSupabaseConfigured } from "../lib/supabase/client";

/**
 * Ingestion worker.
 *
 * Pulls a rolling recent window from every live source and upserts into
 * Supabase. Upstream sources retain nothing for us and several cap how far back
 * you can page, so the durable copy has to be built incrementally by running
 * this on a schedule (daily is enough - observed source lag is 1-2 days).
 *
 *   pnpm ingest                  # last 14 days, every live source
 *   pnpm ingest --days 30        # wider window
 *   pnpm ingest --source fl-fdep-erp
 *   pnpm ingest --dry-run        # fetch and report, write nothing
 */

interface Args {
  days: number;
  sourceId?: string;
  dryRun: boolean;
  includeArchival: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { days: 14, dryRun: false, includeArchival: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--days") args.days = Number.parseInt(argv[++i] ?? "14", 10);
    else if (arg === "--source") args.sourceId = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--include-archival") args.includeArchival = true;
  }
  if (!Number.isFinite(args.days) || args.days < 1) args.days = 14;
  return args;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configured = isSupabaseConfigured();

  if (!configured && !args.dryRun) {
    console.error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --dry-run.",
    );
    process.exitCode = 1;
    return;
  }

  const targets = ALL_SOURCES.filter((a) => {
    if (args.sourceId) return a.descriptor.id === args.sourceId;
    if (!args.includeArchival && ARCHIVAL_SOURCE_IDS.has(a.descriptor.id)) return false;
    // Skip sources whose credential is absent rather than failing the run.
    if (a.descriptor.requiresCredential && !process.env[a.descriptor.requiresCredential]) return false;
    return true;
  });

  if (targets.length === 0) {
    console.error("No sources matched. Check --source, or configure the required credentials.");
    process.exitCode = 1;
    return;
  }

  const from = isoDaysAgo(args.days);
  const to = new Date().toISOString().slice(0, 10);
  console.log(`Ingesting ${from} -> ${to} from ${targets.length} source(s)${args.dryRun ? " (dry run)" : ""}\n`);

  let grandTotal = 0;
  let failures = 0;

  for (const adapter of targets) {
    const { descriptor } = adapter;
    const label = descriptor.label;
    let runId: number | null = null;

    try {
      if (!args.dryRun) {
        await registerSource(descriptor, ARCHIVAL_SOURCE_IDS.has(descriptor.id));
        runId = await startIngestRun(descriptor.id);
      }

      // The worker wants everything in the window, not a UI page.
      const filters = searchFiltersSchema.parse({
        geo_state: descriptor.state === "*" ? undefined : descriptor.state,
        permit_from: from,
        permit_to: to,
      });

      const started = Date.now();
      const { permits, warnings } = await adapter.fetch({ filters, limit: 1000 });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      let written = 0;
      if (!args.dryRun) written = await upsertPermits(permits);

      grandTotal += permits.length;
      console.log(`  ${label}: ${permits.length} rows in ${elapsed}s${args.dryRun ? "" : ` -> ${written} upserted`}`);
      for (const w of warnings) console.log(`      note: ${w}`);

      if (!args.dryRun) {
        await finishIngestRun(runId, { rowsSeen: permits.length, rowsUpserted: written, ok: true });
      }
    } catch (err) {
      failures += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${label}: FAILED - ${message}`);
      if (!args.dryRun) {
        await finishIngestRun(runId, { rowsSeen: 0, rowsUpserted: 0, ok: false, error: message });
      }
    }
  }

  console.log(`\nDone. ${grandTotal} rows across ${targets.length} source(s), ${failures} failure(s).`);
  if (failures === targets.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
