-- Email suppression list.
--
-- Populated by the one-click unsubscribe endpoint and by Resend's bounce and
-- complaint webhooks. Resend terminates accounts above a 0.08% complaint rate
-- or 4% bounce rate, so a suppressed address must never be sent to again.

create table if not exists email_suppressions (
  email        text primary key,
  reason       text not null check (reason in ('unsubscribe','bounce','complaint','manual')),
  detail       text,
  suppressed_at timestamptz not null default now()
);

alter table email_suppressions enable row level security;
alter table email_suppressions force row level security;
-- No policy: suppression is service-role only. It is never client-readable,
-- because the list is a roster of people who asked to be left alone.

grant all on email_suppressions to service_role;

-- Delivery log, so a partner asking "did you send it" has an answer.
create table if not exists digest_sends (
  id          bigserial primary key,
  email       text not null,
  state       text,
  county      text,
  signals     integer not null default 0,
  provider_id text,
  ok          boolean not null,
  error       text,
  sent_at     timestamptz not null default now()
);

create index if not exists digest_sends_email_idx on digest_sends (email, sent_at desc);

alter table digest_sends enable row level security;
alter table digest_sends force row level security;
grant all on digest_sends to service_role;
