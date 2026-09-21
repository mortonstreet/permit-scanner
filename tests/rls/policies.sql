insert into sources (id,label,platform,state,jurisdiction) values ('t-src','Test','arcgis','FL','Test County') on conflict do nothing;
insert into permits (id,source_id,permit_number,address,state,city,file_date,contractor,owner) values
  ('fresh-fl','t-src','F-1','1 Fresh St','FL','Miami', current_date - 2, '{"company":"Fresh GC LLC","phone":"305-555-0100"}'::jsonb, '{"company":"Dev Co"}'::jsonb),
  ('old-fl','t-src','O-1','2 Old St','FL','Miami', current_date - 120, '{"company":"Old GC LLC"}'::jsonb, null),
  ('tx-one','t-src','T-1','3 Tex St','TX','Austin', current_date - 2, '{"company":"Tex GC LLC"}'::jsonb, null)
  on conflict (id) do nothing;
insert into enriched_firms (firm_key,firm_name,contact) values ('fresh-gc','Fresh GC LLC','{"work_email":"jane@freshgc.com"}'::jsonb) on conflict do nothing;
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111'::uuid) on conflict do nothing;
insert into orgs (id,name,plan) values ('22222222-2222-2222-2222-222222222222'::uuid,'Acme Excavating','trial') on conflict do nothing;
insert into org_members (org_id,user_id,role) values ('22222222-2222-2222-2222-222222222222'::uuid,'11111111-1111-1111-1111-111111111111'::uuid,'owner') on conflict do nothing;

\echo '--- ANON: only FL, only older than 30d ---'
begin; set local role anon;
  select 'total visible' t, count(*) n from permits
  union all select 'fresh FL (expect 0)', count(*) from permits where id='fresh-fl'
  union all select 'old FL   (expect 1)', count(*) from permits where id='old-fl'
  union all select 'TX       (expect 0)', count(*) from permits where id='tx-one';
commit;

\echo '--- AUTHENTICATED trial org: FL only, fresh included ---'
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select 'entitled states' t, auth_entitled_states()::text n
  union all select 'fresh FL (expect 1)', count(*)::text from permits where id='fresh-fl'
  union all select 'old FL   (expect 1)', count(*)::text from permits where id='old-fl'
  union all select 'TX       (expect 0)', count(*)::text from permits where id='tx-one';
commit;

\echo '--- upgrade org to FL+TX ---'
update orgs set plan='pro', states=array['FL','TX'] where id='22222222-2222-2222-2222-222222222222';
begin; set local role authenticated; set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select 'entitled states' t, auth_entitled_states()::text n
  union all select 'TX       (expect 1)', count(*)::text from permits where id='tx-one';
commit;

\echo '--- a DIFFERENT user with no org sees nothing ---'
begin; set local role authenticated; set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  select 'permits visible (expect 0)' t, count(*) n from permits;
commit;

\echo '--- enrichment is unreachable from both client roles ---'
begin; set local role anon;
  do $$ begin perform 1 from enriched_firms; raise notice 'FAIL anon read'; exception when others then raise notice 'OK  anon blocked: %', SQLERRM; end $$;
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
  do $$ begin perform 1 from enriched_firms; raise notice 'FAIL authed read'; exception when others then raise notice 'OK  authed blocked: %', SQLERRM; end $$;
  do $$ begin perform 1 from enrichment_calls; raise notice 'FAIL calls read'; exception when others then raise notice 'OK  calls blocked: %', SQLERRM; end $$;
  do $$ begin perform 1 from ingest_runs; raise notice 'FAIL ingest read'; exception when others then raise notice 'OK  ingest blocked: %', SQLERRM; end $$;
commit;

\echo '--- writes from a client role are refused ---'
begin; set local role authenticated; set local request.jwt.claim.sub='11111111-1111-1111-1111-111111111111';
  do $$ begin insert into permits (id,source_id,state) values ('evil','t-src','FL'); raise notice 'FAIL insert'; exception when others then raise notice 'OK  insert blocked'; end $$;
  do $$ begin update permits set job_value=1 where id='fresh-fl'; raise notice 'FAIL update'; exception when others then raise notice 'OK  update blocked'; end $$;
  do $$ begin delete from permits where id='old-fl'; raise notice 'FAIL delete'; exception when others then raise notice 'OK  delete blocked'; end $$;
commit;

\echo '--- service_role (worker) sees and writes everything ---'
begin; set local role service_role;
  select 'permits' t, count(*)::text n from permits
  union all select 'enrichment', count(*)::text from enriched_firms;
commit;

\echo '--- public_permits view exposes no contact data ---'
select string_agg(column_name, ', ' order by ordinal_position) as exposed_columns
from information_schema.columns where table_name='public_permits';
