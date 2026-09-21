-- Permit Scanner schema.
--
-- Two jobs: be the durable store for permits the ingestion worker pulls from
-- live sources (which retain nothing), and cache enrichment results so we never
-- pay a provider twice for the same firm.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- sources
create table if not exists sources (
  id            text primary key,
  label         text not null,
  platform      text not null,
  state         text not null,
  county        text,
  city          text,
  jurisdiction  text not null,
  cadence       text not null default 'unknown',
  archival      boolean not null default false,
  notes         text,
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- permits
create table if not exists permits (
  id              text primary key,
  source_id       text not null references sources(id) on delete cascade,

  permit_number   text,
  status          text not null default 'unknown',
  status_raw      text,
  description     text,
  permit_type     text,
  tags            text[] not null default '{}',

  address         text,
  state           text,
  county          text,
  city            text,
  zipcode         text,
  jurisdiction    text,
  latitude        double precision,
  longitude       double precision,

  job_value       bigint,
  fees            bigint,
  total_cost      bigint,

  file_date       date,
  issue_date      date,
  final_date      date,

  contractor      jsonb,
  owner           jsonb,
  property        jsonb not null default '{}'::jsonb,
  source_fields   jsonb not null default '{}'::jsonb,

  -- The firm we will try to reach, denormalized for cheap grouping and joins.
  firm_name       text generated always as (
    coalesce(owner->>'company', owner->>'name', contractor->>'company', contractor->>'name')
  ) stored,

  ingested_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One row per permit per source; re-ingestion updates rather than duplicates.
  constraint permits_source_number_addr unique (source_id, permit_number, address)
);

-- Freshness is the primary access pattern: "what landed in my area this week".
create index if not exists permits_recency_idx on permits (state, coalesce(file_date, issue_date) desc);
create index if not exists permits_county_idx  on permits (state, county, coalesce(file_date, issue_date) desc);
create index if not exists permits_city_idx    on permits (state, city, coalesce(file_date, issue_date) desc);
create index if not exists permits_zip_idx     on permits (zipcode);
create index if not exists permits_tags_idx    on permits using gin (tags);
create index if not exists permits_desc_trgm   on permits using gin (description gin_trgm_ops);
create index if not exists permits_firm_trgm   on permits using gin (firm_name gin_trgm_ops);
create index if not exists permits_status_idx  on permits (status);

-- ------------------------------------------------------------ enrichment
-- Keyed by normalized firm name so every permit naming the same developer
-- reuses one paid lookup.
create table if not exists enriched_firms (
  firm_key        text primary key,
  firm_name       text not null,
  company         jsonb,
  contact         jsonb,
  provider_chain  text[] not null default '{}',
  confidence      numeric(3,2) not null default 0,
  credits_spent   integer not null default 0,
  notes           text[] not null default '{}',
  resolved_at     timestamptz not null default now(),
  -- Re-resolve after this; contact data decays.
  expires_at      timestamptz not null default (now() + interval '90 days')
);

create index if not exists enriched_firms_expiry_idx on enriched_firms (expires_at);

-- ----------------------------------------------------------------- audit
-- Every paid provider call, so spend is attributable per permit and per firm.
create table if not exists enrichment_calls (
  id           bigserial primary key,
  firm_key     text not null,
  permit_id    text,
  provider     text not null,
  operation    text not null,
  credits      integer not null default 0,
  success      boolean not null,
  detail       text,
  called_at    timestamptz not null default now()
);

create index if not exists enrichment_calls_firm_idx on enrichment_calls (firm_key, called_at desc);

-- --------------------------------------------------------------- ingestion
create table if not exists ingest_runs (
  id            bigserial primary key,
  source_id     text not null references sources(id) on delete cascade,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  rows_seen     integer not null default 0,
  rows_upserted integer not null default 0,
  ok            boolean,
  error         text
);

create index if not exists ingest_runs_source_idx on ingest_runs (source_id, started_at desc);

-- Keep updated_at honest on re-ingestion.
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists permits_touch_updated_at on permits;
create trigger permits_touch_updated_at
  before update on permits
  for each row execute function touch_updated_at();
