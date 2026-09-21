#!/usr/bin/env bash
# Verify the RLS policies against a throwaway Postgres database.
#
# Supabase local (`supabase start`) is the ideal target, but it needs Docker.
# This runs the same migrations against any Postgres, after stubbing the few
# Supabase-provided objects the policies depend on (auth.uid, auth.users and
# the anon / authenticated / service_role roles).
#
#   ./scripts/test-rls.sh              # uses a local postgres on :5432
#   DB=permit_rls ./scripts/test-rls.sh
set -euo pipefail

DB="${DB:-permit_stack_rls_test}"
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/libpq/bin:$PATH"

command -v psql >/dev/null || { echo "psql not found on PATH"; exit 1; }
pg_isready >/dev/null || { echo "no Postgres accepting connections"; exit 1; }

echo "Rebuilding $DB..."
dropdb --if-exists "$DB"
createdb "$DB"

# Stand in for the pieces hosted Supabase provides.
psql -d "$DB" -q <<'SQL'
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
SQL

for m in supabase/migrations/*.sql; do
  echo "Applying $(basename "$m")"
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$m" > /dev/null
done

echo
psql -d "$DB" -q -f tests/rls/policies.sql 2>&1 \
  | grep -vE "^INSERT|^UPDATE|^BEGIN|^COMMIT|^SET|^DO$|^$" \
  | sed 's/psql:[^:]*:[0-9]*: //'

echo
if psql -d "$DB" -q -f tests/rls/policies.sql 2>&1 | grep -q "FAIL"; then
  echo "RLS: FAILURES PRESENT"; exit 1
else
  echo "RLS: all policy assertions passed"
fi
