import { getContainer } from "@/lib/container";
import { authorize, fail, isFirstParty, ok } from "@/lib/api/respond";
import { parseFilters } from "@/lib/filters";
import { rankSignals } from "@/lib/signal";
import { buildDigest, type DigestRecipient } from "@/lib/notify/digest";
import { emailConfigured, sendDigest } from "@/lib/notify/resend";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/v1/digest
 *
 * Builds and sends the daily developer-signal digest to one or more partner
 * GCs. Each recipient gets only their territory.
 *
 * Body:
 *   recipients  [{ email, company?, state, county? }]
 *   window      days back (default 1 - a daily send should not repeat)
 *   min_score   floor (default 55)
 *   dry_run     render and return without sending (default false)
 *
 * Protected by PERMIT_API_KEYS when set, because it spends email quota.
 */
export async function POST(request: Request) {
  const auth = authorize(request);
  if (!auth.ok && !isFirstParty(request)) return auth.response;

  let body: {
    recipients?: DigestRecipient[];
    window?: number;
    min_score?: number;
    dry_run?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return fail("bad_request", "Expected a JSON body with a recipients array.");
  }

  const recipients = body.recipients ?? [];
  if (recipients.length === 0) {
    return fail("bad_request", "At least one recipient is required.");
  }
  const invalid = recipients.find((r) => !r.email?.includes("@") || !r.state);
  if (invalid) {
    return fail("bad_request", `Each recipient needs an email and a two-letter state (bad entry: ${JSON.stringify(invalid)}).`);
  }

  const windowDays = Math.min(Math.max(body.window ?? 1, 1), 30);
  const minScore = Math.min(Math.max(body.min_score ?? 55, 0), 100);
  const dryRun = body.dry_run === true;

  if (!dryRun && !emailConfigured()) {
    return fail("not_configured",
      "Email is not configured. Set RESEND_API_KEY and RESEND_FROM_ADDRESS, or pass dry_run: true.");
  }

  const c = getContainer();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const results: Array<Record<string, unknown>> = [];

  // Sequential rather than parallel: one query per territory, and Resend's
  // rate limit is low enough that fanning out buys nothing.
  for (const recipient of recipients) {
    const params = new URLSearchParams({
      geo_state: recipient.state.toUpperCase(),
      permit_from: isoDaysAgo(windowDays),
      permit_to: isoToday(),
    });
    if (recipient.county) params.set("geo_county", recipient.county);

    const parsed = parseFilters(params);
    if (!parsed.ok) {
      results.push({ to: recipient.email, sent: false, error: parsed.error });
      continue;
    }

    try {
      const search = await c.search.search(parsed.filters, { signal: request.signal, poolSize: 1500 });
      const signals = rankSignals(search.items, c.clock.now(), {
        windowDays, minScore, stage: "all", limit: 15,
        // Only jobs nobody has won yet - the whole point of the send.
        openOnly: true,
      });

      const content = buildDigest(signals, recipient, { appUrl, windowDays });

      if (dryRun) {
        results.push({
          to: recipient.email, sent: false, dry_run: true,
          subject: content.subject, signals: signals.length,
          preview_text: content.text.slice(0, 600),
        });
        continue;
      }

      // Nothing to say is a reason not to send, not a reason to send nothing.
      if (signals.length === 0) {
        results.push({ to: recipient.email, sent: false, skipped: "no open jobs in window" });
        continue;
      }

      const send = await sendDigest(recipient, content);
      results.push({ ...send, signals: signals.length, subject: content.subject });
    } catch (err) {
      results.push({ to: recipient.email, sent: false, error: err instanceof Error ? err.message : "failed" });
    }
  }

  return ok(results, {
    window_days: windowDays,
    min_score: minScore,
    dry_run: dryRun,
    email_configured: emailConfigured(),
    sent: results.filter((r) => r.sent).length,
  });
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
