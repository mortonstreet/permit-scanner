import { ok, fail } from "@/lib/api/respond";
import { getDbprIndex, lookupFirm, lookupPerson } from "@/lib/enrich/gov/fl-dbpr";
import { lookupOrlandoBtr } from "@/lib/enrich/gov/orlando-btr";
import { indexStatus } from "@/lib/enrich/gov/index-store";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * GET /api/v1/gov
 *
 * Diagnostics and direct lookups against the free Florida public-records
 * indexes, so their coverage can be inspected without going through the
 * enrichment waterfall.
 *
 *   ?firm=BALL CONSTRUCTION, INC.
 *   ?first=KATRINA&last=DE JESUS
 *   ?btr=JIMENEZ CONTRACTING
 *   (no params) -> index stats
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const firm = params.get("firm");
  const first = params.get("first");
  const last = params.get("last");
  const btr = params.get("btr");

  try {
    if (firm) return ok({ query: firm, match: await lookupFirm(firm, params.get("license")) });
    if (first && last) return ok({ query: { first, last }, person: await lookupPerson(first, last) });
    if (btr) return ok({ query: btr, match: await lookupOrlandoBtr(btr) });

    const index = await getDbprIndex();
    return ok({
      sources: [
        {
          id: "fl-dbpr",
          label: "FL DBPR construction licence extracts",
          refresh: "daily",
          cost: "free",
          applicants: index.counts.applicants,
          with_phone: index.counts.withPhone,
          phone_fill_pct: Math.round((index.counts.withPhone / index.counts.applicants) * 1000) / 10,
          firms_with_named_qualifier: index.counts.firms,
          licence_rows: index.counts.licences,
          carries: ["name", "phone", "city", "licence number"],
        },
        {
          id: "orlando-btr",
          label: "City of Orlando business tax receipts",
          refresh: "daily",
          cost: "free",
          carries: ["business name", "owner name", "phone", "email"],
          note: "Orlando only. The one free source with phone and email together.",
        },
      ],
      cached_indexes: indexStatus(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Government lookup failed";
    // DBPR blocks datacenter egress, so this path fails on Vercel while
    // working locally. Report it as a known, recoverable condition rather
    // than a generic upstream error.
    if (message.includes("403")) {
      return ok({
        available: false,
        reason: "DBPR blocks datacenter IPs; this index only builds from an allowed network.",
        remedy: "Run `pnpm gov:build-index` and commit the artifact, or build it from the Railway worker.",
        cached_indexes: indexStatus(),
      });
    }
    return fail("upstream_failed", message);
  }
}
