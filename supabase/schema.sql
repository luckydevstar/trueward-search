-- ===========================================================================
-- Trueward Search — schema
--
-- Lives in the same Supabase project as Trueward Guru and the calendar. Every
-- object is prefixed `search_`, so no name here collides with either.
--
-- Safe to run more than once.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Jobs
--
-- `posted_at` is timestamptz because a job board's "2 hours ago" is an
-- instant; the grouping into Today/Yesterday happens in the viewer's zone.
--
-- `dedupe_key` is company+title normalised, so the same job posted to four
-- boards is stored once. It is not unique — a dismissed row must be able to
-- coexist with nothing, and enforcing uniqueness in the database would make
-- an ordinary second posting an error rather than a skip.
-- --------------------------------------------------------------------------
create table if not exists search_job (
  id          bigint generated always as identity primary key,
  source      text not null,
  source_id   text not null,
  dedupe_key  text not null,
  title       text not null,
  company     text,
  location    text,
  salary      text,
  url         text not null,
  description text,
  posted_at   timestamptz not null,
  fetched_at  timestamptz not null default now(),
  status      text not null default 'new',
  notes       text,
  manual      boolean not null default false,
  -- Free text as the board words it ("201-500 employees"), not a number.
  -- Boards disagree about bucket boundaries, and parsing them into a range
  -- would invent a precision none of them actually offer.
  --
  -- Only Jobright supplies this today; everything else leaves it null, which
  -- is why the UI shows it when present rather than reserving a column.
  company_size text,

  constraint search_job_status_known check (status in ('new', 'applied', 'dismissed')),
  -- What makes a re-scrape idempotent: the same posting from the same board
  -- is one row however many times it is seen.
  constraint search_job_source_unique unique (source, source_id)
);

alter table search_job add column if not exists company_size text;

-- The list query's order, as one index, so paging never sorts the table.
create index if not exists search_job_posted_idx
  on search_job (posted_at desc, id desc);
create index if not exists search_job_dedupe_idx on search_job (dedupe_key);
-- The default view is everything not dismissed, which is most of the table
-- and so wants a partial index rather than one on `status`.
create index if not exists search_job_active_idx
  on search_job (posted_at desc) where status <> 'dismissed';

-- --------------------------------------------------------------------------
-- Rejections
--
-- Jobs that failed the rules, remembered so their detail pages are not
-- re-fetched on every run. This is the difference between a polite scraper
-- and one that hammers a board for the same 200 postings every half hour.
-- --------------------------------------------------------------------------
create table if not exists search_rejected (
  source    text not null,
  source_id text not null,
  reason    text,
  seen_at   timestamptz not null default now(),
  primary key (source, source_id)
);

create table if not exists search_run (
  source      text primary key,
  started_at  timestamptz,
  finished_at timestamptz,
  fetched     integer,
  accepted    integer,
  inserted    integer,
  error       text
);

-- --------------------------------------------------------------------------
-- Views
--
-- `security_invoker` so the caller's RLS applies. A view defined without it
-- runs as its owner and would hand every row to anyone who could name it —
-- which would quietly undo the policies below.
-- --------------------------------------------------------------------------

-- The list shape. `left(description, 400)` is here rather than in the client
-- because PostgREST cannot express it in a select, and shipping 5 KB of
-- description per row to render a 400-character snippet is most of the
-- payload for none of the page.
drop view if exists search_job_list;
create view search_job_list with (security_invoker = on) as
  select id, source, title, company, company_size, location, salary, url,
         left(description, 400) as snippet,
         -- Carried so the search can filter on the full text. It is never
         -- selected — PostgREST can filter on a column the query does not
         -- return — so the payload stays the snippet.
         description,
         posted_at, fetched_at, status, notes, manual
    from search_job;

drop view if exists search_job_counts;
create view search_job_counts with (security_invoker = on) as
  select source, status, count(*)::int as n
    from search_job group by source, status;

-- --------------------------------------------------------------------------
-- Who may use this app
--
-- The same accounts as Trueward Guru, admins only. This app has no user
-- table and creates nobody.
--
-- SECURITY DEFINER because `app_user` carries its own RLS, and a policy that
-- had to satisfy *that* policy first would be circular. `stable` so it is
-- evaluated once per statement rather than once per row.
-- --------------------------------------------------------------------------
create or replace function public.search_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_user
    where id = auth.uid()
      and role::text in ('admin', 'super_admin')
  )
$$;

revoke all on function public.search_is_admin() from public;
grant execute on function public.search_is_admin() to authenticated;

-- --------------------------------------------------------------------------
-- Row level security
--
-- RLS is the boundary. Every request from the app carries the signed-in
-- user's own token; delete the application code and an anonymous reader still
-- gets nothing.
--
-- The scraper is the one thing with no user behind it, and it runs under the
-- service-role key — which bypasses these entirely. See src/lib/supabase.ts
-- for why that is confined to the scrape path.
-- --------------------------------------------------------------------------
alter table search_job      enable row level security;
alter table search_rejected enable row level security;
alter table search_run      enable row level security;

drop policy if exists search_job_admin on search_job;
create policy search_job_admin on search_job
  for all using (search_is_admin()) with check (search_is_admin());

drop policy if exists search_rejected_admin on search_rejected;
create policy search_rejected_admin on search_rejected
  for all using (search_is_admin()) with check (search_is_admin());

drop policy if exists search_run_admin on search_run;
create policy search_run_admin on search_run
  for all using (search_is_admin()) with check (search_is_admin());
