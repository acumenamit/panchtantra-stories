-- P0-9 storage check: run after 'supabase seed buckets --linked' created the buckets from config.toml. Fails (so this
-- migration is not recorded) unless both buckets have exactly the intended settings and Storage has no access rules
-- that would let the public key upload, list or read private files. It changes nothing.
do $$
declare
  b record;
begin
  -- content: public reads of packages, catalogue, WebP/JPEG and MP3 (spec §3.3); 10 MiB per file.
  select * into b from storage.buckets where id = 'content';
  if not found then
    raise exception 'storage check: bucket content does not exist (run supabase seed buckets --linked first)';
  end if;
  if b.public is distinct from true or b.file_size_limit is distinct from 10485760
     or (select array_agg(m order by m) from unnest(b.allowed_mime_types) m)
        is distinct from array['application/json', 'audio/mpeg', 'image/jpeg', 'image/webp'] then
    raise exception 'storage check: bucket content is not public / 10 MiB / json, mpeg, jpeg, webp (got public=%, limit=%, types=%)',
      b.public, b.file_size_limit, b.allowed_mime_types;
  end if;

  -- masters: private originals, approval records, waivers, reports, media log (spec §3.3, NI-3); 50 MiB per file.
  select * into b from storage.buckets where id = 'masters';
  if not found then
    raise exception 'storage check: bucket masters does not exist (run supabase seed buckets --linked first)';
  end if;
  if b.public is distinct from false or b.file_size_limit is distinct from 52428800
     or (select array_agg(m order by m) from unnest(b.allowed_mime_types) m)
        is distinct from array['application/json', 'application/x-ndjson', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'] then
    raise exception 'storage check: bucket masters is not private / 50 MiB / its 6 types (got public=%, limit=%, types=%)',
      b.public, b.file_size_limit, b.allowed_mime_types;
  end if;

  -- No other buckets, RLS on for Storage's tables, and no access rules at all: only the secret key (which bypasses
  -- RLS, used by the publisher on this PC and in Actions) can upload, list, change or read private files.
  if exists (select 1 from storage.buckets where id not in ('content', 'masters')) then
    raise exception 'storage check: unexpected bucket(s): %', (select string_agg(id, ', ') from storage.buckets where id not in ('content', 'masters'));
  end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'storage.buckets'::regclass) then
    raise exception 'storage check: RLS is off on storage.objects or storage.buckets';
  end if;
  if exists (select 1 from pg_policy where polrelid in ('storage.objects'::regclass, 'storage.buckets'::regclass)) then
    raise exception 'storage check: Storage has access policies: %',
      (select string_agg(polname, ', ') from pg_policy where polrelid in ('storage.objects'::regclass, 'storage.buckets'::regclass));
  end if;

  raise notice 'storage check passed';
end
$$;
