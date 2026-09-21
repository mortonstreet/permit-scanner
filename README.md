# Permit Stack

New construction permits the day they are filed, with the decision maker attached.

A permit-signal platform for excavation and site-work contractors. It closes two gaps:
the **signal gap** (contractors hear about a job when the ad posts) and the **speed gap**
(by then the bidding war has started). It reads permits straight from the jurisdictions
that issue them, normalizes them into one model, and resolves the firm named on the
permit to a contactable human.

```bash
pnpm install
pnpm dev            # http://localhost:3210
```

No API keys are required. Every Florida, Texas and metro source below is free and keyless.

---

## What this is, honestly

The product thesis is speed. Two findings from building it shape the whole architecture:

**1. Aggregators are too slow to be the signal.** Shovels' own API spec states a
**median 84-day ingestion lag (p90 188 days)** between a permit's start date and it
appearing in their data. Any "recent activity" feature built on an aggregator is
structurally months behind. The direct jurisdiction endpoints in this repo run
**0–4 days** behind. That gap *is* the product; it is why the registry is built on
direct sources and why Shovels is relegated to national backfill.

**2. Apify is the wrong tool for permits.** The Apify store's permit actors are almost
entirely AI-generated listings created in 2026 with 0–11 monthly users, and every one
that works is a thin wrapper over a free, keyless public API — at $0.003–$0.03 per
record for data you can `curl`. Combined with the free tier's 7-day dataset retention
and $5/month cap, it fails as a primary source on both cost and architecture. It stays
useful for exactly one job: **Accela and Tyler EnerGov citizen portals**, which have no
public API and genuinely require a browser.

---

## Data sources

22 sources, all probed live on 2026-09-21. `pnpm sources:probe` re-verifies reachability,
field mapping and freshness — a frozen portal still answers HTTP 200, so freshness is
checked explicitly.

### Florida — statewide
| Source | Rows | Lag | Carries |
|---|---|---|---|
| **FL DEP Environmental Resource Permits** | 360,725 | 1d | applicant company, project description, lat/lng |

The earliest signal in the stack and the only statewide Florida feed that exists. An ERP
covers stormwater, dredge and fill, and land clearing — filed *before* the building
permit, which is exactly when a site-work contractor wants the call. Caveat: a large
share of pending ERPs are residential docks and screen canopies, so it needs filtering.

### Florida — jurisdictions
| Source | Rows | Lag | Value | Contractor | Owner |
|---|---|---|---|---|---|
| Miami-Dade County | 139,389 | 2d | ✓ | ✓ +phone | ✓ |
| Orlando | 1,110,929 | 0d | ✓ | ✓ +phone | ✓ |
| Cape Coral | 63,989 | 0d | ✓ | ✓ | — |
| Hillsborough County | 111,229 | 4d | ✓ | — | — |
| Hillsborough site & subdivision review | 2,752 | 2d | — | — | ✓ contact |
| Manatee County | 549,281 | 1d | ✓ | — | ✓ |
| Volusia County | 2,870 | 0d | — | — | — |
| Osceola commercial / residential | 6,157 | 2d | ✓ | — | — |
| Alachua County | 216,347 | 3d | — | ✓ | ✓ |
| Charlotte County | 106,660 | 4d | — | — | ✓ |
| City of Miami | 232,587 | 11d | ✓ | ✓ | — |

Miami-Dade is the only Florida feed carrying owner, contractor, contractor phone *and*
value together. Hillsborough's site & subdivision layer is the strongest pure site-work
signal: site plans sit upstream of the building permit and carry a developer contact
and an acreage.

### Texas and other metros
Fort Worth (1.6M rows, 0d lag, and the only feed with an explicit **Commercial Grading
Permit** type), San Antonio, Austin, Collin CAD (names the builder), Los Angeles,
Chicago, Cincinnati, Baton Rouge.

### Known gaps — these need scraping or a paid feed
**Broward** (WAF-blocked), **Palm Beach County** (internal host only), **Jacksonville /
Duval** (no service exists), **Orange County FL unincorporated**, **Pinellas / Tampa
proper**, **Dallas** (frozen at 2019), **Houston** (no public API). Collectively the
largest remaining hole in Florida coverage. All run Accela or Tyler EnerGov.

Two sources are deliberately kept but flagged **archival**, because a dead portal still
returns 200 and would otherwise serve years-old rows as leads:
- `data.cityofgainesville.org/p798-x3nx` — 96,691 rows, frozen at **2023-02-28**. Use the
  Alachua County layer instead.
- Fort Lauderdale has the best schema in Florida but its feed froze 2026-03-16. One email
  to their GIS team would likely revive it — worth sending.

---

## Architecture

```
lib/sources/       adapters: socrata · arcgis · shovels, one registry
lib/normalize.ts   status, tag, money, date and address normalization
lib/coverage.ts    per-field fill rates, so a filter cannot silently hide data
lib/enrich/        cost-ordered contact waterfall + providers
lib/filters.ts     zod schema over the URL vocabulary
worker/ingest.ts   scheduled pull into Supabase
```

**Source adapters** are pure I/O plus mapping. Any filter a source cannot express
server-side is re-applied in-process by the aggregator, so a search means the same thing
regardless of which jurisdictions answered. Sources are queried in parallel; one failing
degrades to a warning rather than an error.

**Coverage reporting** measures how often each field is actually populated in the current
result scope and surfaces it next to the filter that depends on it. This is the difference
between "no permits match" and "this county doesn't publish job value" — FDEP reports job
value on 0% of records, so filtering on it there would silently return nothing.

**The URL is the state.** Filter params follow the reference app's vocabulary
(`geo_state`, `permit_from`, `permit_q`, `permit_tags`…), so searches are shareable and
the back button works.

---

## Contact enrichment

Cost-ordered, stopping at the first acceptable answer, with a per-permit credit budget.
Nothing is ever enriched speculatively — only on an explicit reveal.

```
0. The permit itself        FREE    many jurisdictions publish the applicant's phone/email
1. Shovels employees        ~$0.02  construction-native, permit-keyed, no LinkedIn dependency
2. ContactOut               ~$0.05  decision-makers endpoint exposes free availability flags
3. RocketReach              ~$0.085 last: ~30% measured hit rate, highest cost per credit
```

Small US construction firms break the standard enrichment stack: the owner often has no
LinkedIn profile and the company often has no corporate email domain. Every LinkedIn-first
provider is matching against a graph these people are not in, which is why they sit last
rather than first.

Results are cached by a **normalized firm key**, so every permit naming the same developer
reuses one paid lookup. Misses are cached too (shorter TTL) so a firm that resolved to
nothing is not retried on every page view.

### ⚠ Commercial constraint — read before selling enriched data

**RocketReach and ContactOut both prohibit reselling their contact data in their standard
terms.** RocketReach's ToS: *"You may not duplicate, copy, resell, reuse, exploit… Lookup
Information"*, with use limited to *"legitimate internal business activities."* ContactOut
publishes no API terms at all; its Terms of Use bar distributing "Materials" without
written consent and cap liability at **$50 AUD**. Apollo's terms are equally restrictive.

This matters because selling leads to contractors is exactly the prohibited motion.

What is cleanly resellable: **the permit records themselves.** Building permits are public
records and the jurisdiction data carries no vendor contract. State contractor-licence
data is likewise public. Notably, **Shovels' FAQ explicitly grants** *"the right to reuse
and resell API output"* — the only vendor here with a contemplated redistribution path
(confirm it in the executed MSA, not the FAQ).

Selling contact records about people you have no relationship with also makes you a **data
broker under the California Delete Act**: registration is **$6,000/yr**, and processing
DROP deletion requests has been mandatory since 2026-08-01.

Practical options: negotiate written redistribution rights (Shovels is the likeliest yes),
or architect enrichment as a *service performed for the buyer* rather than *data sold to
the buyer*. Worth a lawyer before the paid tiers go live.

---

## Commands

```bash
pnpm dev                          # dev server on :3210
pnpm build                        # production build
pnpm test                         # 59 unit tests
pnpm typecheck
pnpm lint

pnpm sources:probe                # reachability + field mapping + freshness, all 22 sources
pnpm ingest --dry-run             # fetch a 14-day window, write nothing
pnpm ingest --days 30             # pull into Supabase
pnpm ingest --source fl-miami-dade
```

## Storage

Supabase is optional; without it the app runs entirely against live sources. Apply
`supabase/migrations/0001_init.sql` to enable durable storage, the enrichment cache and
per-provider cost auditing. This matters because the upstream sources retain nothing for
us — history has to be accumulated by running `pnpm ingest` on a schedule.

## Next steps

1. **Close the Florida gaps.** Broward, Palm Beach, Jacksonville and Pinellas are the
   largest missing markets; all need Accela/EnerGov scraping.
2. **Join state licence boards.** FL DBPR, and CSLB/WA L&I/OR CCB elsewhere, map a licence
   number to a named qualifier for free — the only reliable way to name the owner of a
   four-person GC.
3. **Scrape the contractor's own website.** For a 12-person GC, `info@` *is* the owner's
   inbox, at roughly $0.003/company.
4. **Benchmark before budgeting.** Run 500 permits through the waterfall and measure the
   real hit rate. Every published figure is vendor marketing.
