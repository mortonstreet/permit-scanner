import "dotenv/config";

/**
 * Scheduled digest sender.
 *
 * Runs on Railway cron and calls the app's own /api/v1/digest endpoint, so the
 * worker and the API share one code path and one definition of a good lead.
 *
 *   pnpm digest --dry-run
 *   pnpm digest --window 1
 *
 * Recipients come from DIGEST_RECIPIENTS, a JSON array:
 *   [{"email":"gc@example.com","company":"Acme Excavating","state":"FL","county":"Orange"}]
 */

interface Recipient {
  email: string;
  company?: string;
  state: string;
  county?: string;
}

function parseRecipients(): Recipient[] {
  const raw = process.env.DIGEST_RECIPIENTS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error("DIGEST_RECIPIENTS is not valid JSON");
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const windowIdx = args.indexOf("--window");
  const windowDays = windowIdx >= 0 ? Number.parseInt(args[windowIdx + 1] ?? "1", 10) : 1;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (!appUrl) {
    console.error("Set NEXT_PUBLIC_APP_URL (or APP_URL) to the deployed app, e.g. https://permit-stack.vercel.app");
    process.exitCode = 1;
    return;
  }

  const recipients = parseRecipients();
  if (recipients.length === 0) {
    console.error("No recipients. Set DIGEST_RECIPIENTS to a JSON array.");
    process.exitCode = 1;
    return;
  }

  console.log(`Sending digest to ${recipients.length} recipient(s), ${windowDays}d window${dryRun ? " (dry run)" : ""}`);

  const res = await fetch(`${appUrl}/api/v1/digest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.PERMIT_API_KEY ? { "x-api-key": process.env.PERMIT_API_KEY } : {}),
    },
    body: JSON.stringify({ recipients, window: windowDays, dry_run: dryRun }),
  });

  const body = await res.json();
  if (!res.ok) {
    console.error(`Digest failed (${res.status}):`, body?.error?.message ?? body);
    process.exitCode = 1;
    return;
  }

  for (const r of body.data ?? []) {
    const status = r.sent ? "SENT" : r.dry_run ? "DRY" : r.skipped ? "SKIP" : "FAIL";
    console.log(`  ${status.padEnd(5)} ${r.to}  signals=${r.signals ?? 0}  ${r.error ?? r.skipped ?? r.subject ?? ""}`);
  }
  console.log(`\n${body.meta?.sent ?? 0} sent.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
