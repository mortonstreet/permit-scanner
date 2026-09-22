-- Whether the jurisdiction explicitly stated no contractor is engaged.
--
-- Distinct from a null contractor: an absent value means the feed does not
-- publish contractors, whereas this means the work is provably out to bid.
-- Phoenix writes "TO BE BID" in the professional-of-record field.

alter table permits add column if not exists contractor_unassigned boolean not null default false;

-- The open-jobs query is the product's main read path.
create index if not exists permits_unassigned_idx
  on permits (state, contractor_unassigned, coalesce(file_date, issue_date) desc)
  where contractor_unassigned;
