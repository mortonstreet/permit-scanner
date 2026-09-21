import "dotenv/config";
import { ALL_SOURCES, ARCHIVAL_SOURCE_IDS } from "../lib/sources/registry";

/**
 * Liveness check for every configured source.
 *
 * Public data portals go dark without warning - Gainesville's permit dataset
 * stopped refreshing in 2023 and still serves 200s - so this reports both
 * reachability and the newest record it can see.
 *
 *   pnpm sources:probe
 */
async function main() {
  console.log(`Probing ${ALL_SOURCES.length} source(s)\n`);
  let failures = 0;

  for (const adapter of ALL_SOURCES) {
    const { descriptor } = adapter;
    const archival = ARCHIVAL_SOURCE_IDS.has(descriptor.id) ? " [archival]" : "";
    const needsKey = descriptor.requiresCredential;

    if (needsKey && !process.env[needsKey]) {
      console.log(`  SKIP  ${descriptor.label}${archival} - ${needsKey} not set`);
      continue;
    }

    const started = Date.now();
    const result = await adapter.probe();
    const ms = Date.now() - started;

    if (result.ok) {
      console.log(`  OK    ${descriptor.label}${archival} (${ms}ms) - ${result.detail}`);
    } else {
      failures += 1;
      console.log(`  FAIL  ${descriptor.label}${archival} (${ms}ms) - ${result.detail}`);
    }
  }

  console.log(`\n${failures} failure(s).`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
