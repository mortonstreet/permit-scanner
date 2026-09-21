# Deployment

Three services, each doing one job:

| Service | Role | Runs |
|---|---|---|
| **Vercel** | The app and the public API | on request |
| **Railway** | Ingestion worker | scheduled, one-shot |
| **Supabase** | Postgres + auth + RLS | always |

The app runs against live feeds without Supabase. Supabase adds durable
history, the enrichment cache and per-org entitlements; the worker needs it.

---

## Supabase

The upstream feeds retain nothing for us and several cap how far back you can
page, so history has to be accumulated. That is the worker's whole job.

```bash
supabase projects create permit-stack \
  --org-id <org> --region us-east-1 --db-password "$(openssl rand -base64 24)"

supabase link --project-ref <ref>
supabase db push                      # applies 0001_init.sql then 0002_rls.sql
```

Then set on Vercel and Railway:

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

### Verifying RLS

`supabase db push` does not tell you whether the policies do what you meant.

```bash
pnpm test:rls
```

That rebuilds a throwaway Postgres, applies both migrations, and asserts:

- anon sees Florida only, and only rows older than 30 days
- an authenticated member of a trial org sees Florida including fresh rows
- upgrading the org's `states` immediately widens what that user can read
- a user in no org sees nothing
- `enriched_firms`, `enrichment_calls` and `ingest_runs` are refused at the
  grant level for both client roles, not merely row-filtered
- every client-role insert, update and delete is refused
- `service_role` retains full access
- `public_permits` exposes `has_contractor_phone`, never the number

It needs a local Postgres on :5432. `supabase start` is equivalent when Docker
is healthy.

---

## Vercel

```bash
vercel link --project permit-stack
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel deploy --prod
```

Optional: `PERMIT_API_KEYS` (comma-separated). When set, `/api/v1/*` requires
`X-API-Key`; same-origin requests from the app are always allowed, so setting
it locks down the public API without breaking the UI.

---

## Railway (ingestion worker)

```bash
railway link --project permit-stack
railway variables --set SUPABASE_URL=... --set SUPABASE_SERVICE_ROLE_KEY=...
railway up --detach
```

The service is a one-shot: it pulls a rolling window, upserts, and exits
(`restartPolicyType: NEVER`). Attach a **cron schedule** in the Railway
dashboard rather than leaving it running:

```
0 */6 * * *        # every 6 hours
```

Observed source lag is 0-4 days, so four runs a day is ample; hourly would
just re-read the same rows.

```bash
pnpm ingest --dry-run          # fetch and report, write nothing
pnpm ingest --days 30          # wider backfill
pnpm ingest --source fl-orlando
```

---

## Health

`GET /api/v1/health` reports source count, states covered, whether Supabase is
attached, which enrichment providers are configured, and cache size. Point an
uptime check at it.

`pnpm sources:probe` checks all 22 feeds for reachability, field mapping and
**freshness** — a dead portal still answers 200, so freshness is asserted
explicitly.
