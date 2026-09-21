-- Row-level security.
--
-- Threat model: the anon key ships in the browser, so anything the anon role can
-- reach is public. Permits are public records and safe to read. Everything that
-- costs money or reveals a person - enrichment results, provider call logs,
-- ingestion internals - is service-role only and never reachable from a client.

-- ── roles and helpers ───────────────────────────────────────────────────────

-- Subscriber accounts. An authenticated user maps to one org.
create table if not exists orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text not null default 'trial' check (plan in ('trial','basic','pro','enterprise')),
  -- States this org has paid to see. Empty = trial, limited to the demo state.
  states      text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists org_members (
  org_id   uuid not null references orgs(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  role     text not null default 'member' check (role in ('owner','admin','member')),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_idx on org_members (user_id);

-- Which orgs the caller belongs to. SECURITY DEFINER so the policy can read
-- org_members without recursing through org_members' own policy.
create or replace function auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from org_members where user_id = auth.uid();
$$;

-- States the caller is entitled to. Trial orgs get Florida only.
create or replace function auth_entitled_states()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(distinct s),
    '{}'::text[]
  )
  from orgs o
  join org_members m on m.org_id = o.id and m.user_id = auth.uid()
  cross join lateral unnest(
    case when o.plan = 'trial' or cardinality(o.states) = 0
         then array['FL']
         else o.states end
  ) as s;
$$;

-- ── enable RLS everywhere ───────────────────────────────────────────────────

alter table sources            enable row level security;
alter table permits            enable row level security;
alter table enriched_firms     enable row level security;
alter table enrichment_calls   enable row level security;
alter table ingest_runs        enable row level security;
alter table orgs               enable row level security;
alter table org_members        enable row level security;

-- Force RLS for the table owner too, so a mistake in a migration or a
-- misconfigured pooler cannot quietly bypass these policies.
alter table permits            force row level security;
alter table enriched_firms     force row level security;
alter table enrichment_calls   force row level security;

-- ── sources: public catalogue, read-only ────────────────────────────────────

drop policy if exists sources_read on sources;
create policy sources_read on sources
  for select to anon, authenticated
  using (true);

-- ── permits: public records, but gated by the org's entitled states ─────────

drop policy if exists permits_read_entitled on permits;
create policy permits_read_entitled on permits
  for select to authenticated
  using (state = any (auth_entitled_states()));

-- Anonymous visitors see a deliberately narrow slice: Florida, and only rows
-- already older than the paying window. Fresh signal is the product.
drop policy if exists permits_read_anon_demo on permits;
create policy permits_read_anon_demo on permits
  for select to anon
  using (
    state = 'FL'
    and coalesce(file_date, issue_date) < (current_date - interval '30 days')
  );

-- Writes are ingestion-only. No client role may insert, update or delete;
-- the worker uses the service role, which bypasses RLS entirely.

-- ── enrichment: never reachable from a browser ──────────────────────────────
-- No policies at all. With RLS enabled and no permissive policy, anon and
-- authenticated get zero rows. Only the service role can read these, which is
-- what we want: contact data is served through our API after an entitlement
-- check, never queried directly by a client.

-- ── orgs and membership ─────────────────────────────────────────────────────

drop policy if exists orgs_read_own on orgs;
create policy orgs_read_own on orgs
  for select to authenticated
  using (id in (select auth_org_ids()));

drop policy if exists org_members_read_own on org_members;
create policy org_members_read_own on org_members
  for select to authenticated
  using (user_id = auth.uid() or org_id in (select auth_org_ids()));

-- ── ingest_runs: operational, service role only ─────────────────────────────
-- RLS on, no policy: invisible to clients.

-- ── grants ──────────────────────────────────────────────────────────────────
-- RLS filters rows; grants decide which tables are addressable at all.

revoke all on all tables in schema public from anon, authenticated;

grant select on sources, permits to anon, authenticated;
grant select on orgs, org_members to authenticated;

-- The ingest worker and the API server run as service_role. Hosted Supabase
-- grants this by default, but stating it keeps the schema self-contained and
-- survives a restore into a plain Postgres.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- ── a view that never leaks contact data ────────────────────────────────────
-- security_invoker so the caller's own RLS applies to the underlying permits.

create or replace view public_permits
with (security_invoker = true) as
select
  id, source_id, permit_number, status, description, permit_type, tags,
  address, state, county, city, zipcode, jurisdiction, latitude, longitude,
  job_value, fees, file_date, issue_date, final_date,
  firm_name,
  -- Whether a contact exists, without revealing it.
  (contractor ->> 'phone') is not null as has_contractor_phone,
  coalesce(file_date, issue_date) as posted_date,
  greatest(0, current_date - coalesce(file_date, issue_date)) as days_old
from permits;

grant select on public_permits to anon, authenticated;
