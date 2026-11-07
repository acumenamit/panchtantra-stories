-- P0-9 self-check: fails (so this migration is not recorded) unless every permission from the previous migration is
-- exactly as intended. It changes nothing: the probe objects it creates are dropped again before it ends, and the
-- whole migration runs as one transaction.
do $$
declare
  api_roles constant text[] := array['anon', 'authenticated', 'service_role'];
  tables constant text[] := array['private.reader_reports', 'private.story_counters'];
  table_privs text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  r text;
  t text;
  p text;
  extra text;
begin
  if current_setting('server_version_num')::int >= 170000 then
    table_privs := array_append(table_privs, 'MAINTAIN');
  end if;

  -- Owners: everything belongs to postgres (not to a temporary CLI login role).
  if (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'private') <> 'postgres' then
    raise exception 'lock-down check: schema private is not owned by postgres';
  end if;
  foreach t in array tables loop
    if (select pg_get_userbyid(relowner) from pg_class where oid = t::regclass) <> 'postgres' then
      raise exception 'lock-down check: % is not owned by postgres', t;
    end if;
  end loop;
  if (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.keep_alive()'::regprocedure) <> 'postgres' then
    raise exception 'lock-down check: public.keep_alive() is not owned by postgres';
  end if;

  -- Tables: RLS on, no policies, and no privilege at all for the Data API roles (PUBLIC grants count too).
  foreach t in array tables loop
    if not (select relrowsecurity from pg_class where oid = t::regclass) then
      raise exception 'lock-down check: RLS is off on %', t;
    end if;
    if exists (select 1 from pg_policy where polrelid = t::regclass) then
      raise exception 'lock-down check: % has a policy', t;
    end if;
    foreach r in array api_roles loop
      foreach p in array table_privs loop
        if has_table_privilege(r, t, p) then
          raise exception 'lock-down check: % has % on %', r, p, t;
        end if;
      end loop;
      if has_any_column_privilege(r, t, 'SELECT, INSERT, UPDATE, REFERENCES') then
        raise exception 'lock-down check: % has a column privilege on %', r, t;
      end if;
    end loop;
  end loop;

  foreach r in array api_roles loop
    if has_schema_privilege(r, 'private', 'USAGE') or has_schema_privilege(r, 'private', 'CREATE') then
      raise exception 'lock-down check: % can use schema private', r;
    end if;
    foreach p in array array['USAGE', 'SELECT', 'UPDATE'] loop
      if has_sequence_privilege(r, 'private.reader_reports_id_seq', p) then
        raise exception 'lock-down check: % has % on private.reader_reports_id_seq', r, p;
      end if;
    end loop;
  end loop;

  -- keep_alive(): anon may execute it (and reach schema public); no other role gets it, directly or via PUBLIC.
  if not (has_schema_privilege('anon', 'public', 'USAGE')
          and has_function_privilege('anon', 'public.keep_alive()', 'EXECUTE')) then
    raise exception 'lock-down check: anon cannot execute public.keep_alive()';
  end if;
  if has_function_privilege('public', 'public.keep_alive()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.keep_alive()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.keep_alive()', 'EXECUTE') then
    raise exception 'lock-down check: a role other than anon can execute public.keep_alive()';
  end if;

  -- "anon may execute ONLY keep_alive()" (spec §3.3): nothing else in the API schemas may be callable or readable.
  -- graphql_public.graphql(...) is Supabase's own GraphQL placeholder (owner supabase_admin, cannot be revoked by
  -- postgres); graphql_public is removed from the exposed schemas (owner decision 2026-11-07), which the
  -- keep-alive workflow proves over HTTP on every run.
  select string_agg(fn.oid::regprocedure::text, ', ' order by fn.oid::regprocedure::text) into extra
  from pg_proc fn join pg_namespace ns on ns.oid = fn.pronamespace
  where ns.nspname in ('public', 'graphql_public')
    and fn.oid <> 'public.keep_alive()'::regprocedure
    and fn.oid is distinct from to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)')
    and (has_function_privilege('anon', fn.oid, 'EXECUTE') or has_function_privilege('authenticated', fn.oid, 'EXECUTE'));
  if extra is not null then
    raise exception 'lock-down check: anon/authenticated can also execute %', extra;
  end if;

  select string_agg(c.oid::regclass::text, ', ' order by c.oid::regclass::text) into extra
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname in ('public', 'graphql_public') and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
         or has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
         or has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE')
         or has_any_column_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE'));
  if extra is not null then
    raise exception 'lock-down check: anon/authenticated can reach %', extra;
  end if;

  -- Defaults: a NEW function, table and sequence in "public" must give the Data API roles nothing, and the
  -- automatic-RLS event trigger must still switch RLS on for a new table.
  create function public.p0_9_probe_fn() returns integer language sql as 'select 1';
  create table public.p0_9_probe_table (x integer);
  create sequence public.p0_9_probe_seq;
  if not (select relrowsecurity from pg_class where oid = 'public.p0_9_probe_table'::regclass) then
    raise exception 'lock-down check: automatic RLS did not switch on RLS for a new table in public';
  end if;
  if has_function_privilege('public', 'public.p0_9_probe_fn()', 'EXECUTE') then
    raise exception 'lock-down check: PUBLIC can execute a new function in public by default';
  end if;
  foreach r in array api_roles loop
    if has_function_privilege(r, 'public.p0_9_probe_fn()', 'EXECUTE') then
      raise exception 'lock-down check: % can execute a new function in public by default', r;
    end if;
    foreach p in array table_privs loop
      if has_table_privilege(r, 'public.p0_9_probe_table', p) then
        raise exception 'lock-down check: % gets % on a new table in public by default', r, p;
      end if;
    end loop;
    foreach p in array array['USAGE', 'SELECT', 'UPDATE'] loop
      if has_sequence_privilege(r, 'public.p0_9_probe_seq', p) then
        raise exception 'lock-down check: % gets % on a new sequence in public by default', r, p;
      end if;
    end loop;
  end loop;
  drop function public.p0_9_probe_fn();
  drop table public.p0_9_probe_table;
  drop sequence public.p0_9_probe_seq;

  raise notice 'lock-down check passed';
end
$$;
