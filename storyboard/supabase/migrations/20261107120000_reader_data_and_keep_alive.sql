-- P0-9: reader data tables, keep_alive(), and the Data API lock-down (spec §3.3, OD-2, OD-5, OQ-2).
-- The two tables live in schema "private", which the Data API does not expose. The only thing the public
-- publishable key (Postgres role anon) may use is public.keep_alive(). The next migration checks all of this.
-- Writes arrive in P1-7 through functions on a server-side connection; the P1-7 route handlers validate every
-- value against the published catalogue first, and these constraints are the second line of defence.

-- 1. Functions: Postgres lets every role (PUBLIC) execute a new function unless that is revoked. Remove that
--    default for every function postgres creates from now on, and the Data API roles' defaults in "public"
--    (Supabase "Securing your API"). Statements most likely to fail come first.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;

-- 2. The "Enable automatic RLS" project option created public.rls_auto_enable() (owner postgres) before the
--    default above existed, so everyone may execute it. The event trigger ensure_rls does not need that
--    privilege to fire (the next migration proves automatic RLS still works). Skipped where it does not exist.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;
  end if;
end
$$;

-- 3. A schema the Data API never exposes.
create schema private;
revoke all on schema private from public, anon, authenticated, service_role;

-- 4. Reader reports (OD-5, spec §6.11): six fixed reasons, no free text, no identifiers, the UTC hour only.
--    One row per distinct report per hour with a count (owner decision 2026-11-07): reports carry no identity,
--    so identical reports in the same hour carry the same information, and a flood of identical requests
--    cannot grow the table. The unique key leads with received_hour, so it also serves the daily review.
create table private.reader_reports (
  id bigint generated always as identity primary key,
  received_hour timestamptz not null default date_trunc('hour', now(), 'UTC')
    check (received_hour = (date_trunc('hour', received_hour at time zone 'UTC') at time zone 'UTC')),
  story_id text not null check (length(story_id) between 3 and 64 and story_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  package_sha256 text not null check (package_sha256 ~ '^[a-f0-9]{64}$'),
  node_id text check (node_id ~ '^[a-z][a-z0-9_]{0,47}$'), -- null = the report is about the whole story
  content_locale text not null check (content_locale in ('en', 'hi', 'ar')), -- = src/core/locales.ts LOCALE_CODES
  reason text not null check (reason in ('scary_or_upsetting', 'not_right_for_age', 'language_problem',
                                         'picture_or_sound_problem', 'story_not_working', 'something_else')),
  app_version text not null check (app_version ~ '^[a-f0-9]{40}$'), -- the deployment's full git commit SHA
  report_count bigint not null default 1 check (report_count >= 1),
  constraint reader_reports_hourly_key unique nulls not distinct
    (received_hour, story_id, package_sha256, node_id, content_locale, reason, app_version)
);

-- 5. Story counters (OD-2, OQ-6, spec §6.10): one row per UTC day, story, locale and event. No identifiers.
create table private.story_counters (
  day date not null default ((now() at time zone 'UTC')::date),
  story_id text not null check (length(story_id) between 3 and 64 and story_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  locale text not null check (locale in ('en', 'hi', 'ar')), -- = src/core/locales.ts LOCALE_CODES
  event text not null check (event in ('start', 'ending', 'read_to_me')),
  count bigint not null default 0 check (count >= 0),
  primary key (day, story_id, locale, event)
);

-- 6. Lock both tables: RLS on with no policies (deny by default), and no privileges at all for the Data API roles.
alter table private.reader_reports enable row level security;
alter table private.story_counters enable row level security;
revoke all on table private.reader_reports, private.story_counters from public, anon, authenticated, service_role;
revoke all on sequence private.reader_reports_id_seq from public, anon, authenticated, service_role;

-- 7. keep_alive() (OQ-2): a no-op the scheduled GitHub Actions run calls with the publishable key. Reads and
--    writes nothing.
create function public.keep_alive()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select true $$;

revoke all on function public.keep_alive() from public, anon, authenticated, service_role;
grant execute on function public.keep_alive() to anon;

comment on function public.keep_alive() is 'No-op called by the keep-alive workflow so the Free project is not paused (spec OQ-2).';
