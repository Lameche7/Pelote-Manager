create or replace function public.admin_import_championship_sources_safe(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  championship_payload jsonb := payload -> 'championship';
  source_provider text := coalesce(
    nullif(btrim(championship_payload ->> 'sourceProvider'), ''),
    'ffpb'
  );
  source_external_id text := nullif(
    btrim(championship_payload ->> 'sourceExternalId'),
    ''
  );
  source_url text := nullif(btrim(championship_payload ->> 'sourceUrl'), '');
  championship_name text := btrim(championship_payload ->> 'name');
  specialty text := btrim(championship_payload ->> 'specialty');
  season_label text := coalesce(btrim(championship_payload ->> 'seasonLabel'), '');
  target_championship_id uuid;
  existing_batch_id uuid;
  existing_summary jsonb;
  match_reason text;
begin
  if not public.has_club_permission(target_club_id, 'championships.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if payload is null
    or jsonb_typeof(payload) <> 'object'
    or championship_payload is null
    or jsonb_typeof(championship_payload) <> 'object'
    or championship_name = ''
    or specialty = ''
    or jsonb_typeof(payload -> 'files') <> 'array'
    or jsonb_array_length(payload -> 'files') < 2
  then
    raise exception 'Championship import payload is invalid' using errcode = '22023';
  end if;

  -- 1. Stable official source identity when available.
  if source_external_id is not null then
    select championship.id
    into target_championship_id
    from public.championships as championship
    where championship.source_provider = source_provider
      and championship.source_external_id = source_external_id
    limit 1;

    if target_championship_id is not null then
      match_reason := 'source';
    end if;
  end if;

  -- 2. Same exact full source files, even when the first import had no URL.
  if target_championship_id is null then
    select batch.championship_id, batch.id, batch.summary
    into target_championship_id, existing_batch_id, existing_summary
    from public.championship_import_batches as batch
    join public.championship_club_links as link
      on link.championship_id = batch.championship_id
     and link.club_id = target_club_id
     and link.access_role = 'manager'
    where batch.status = 'applied'
      and (
        select count(*)
        from public.championship_import_files as imported_file
        where imported_file.batch_id = batch.id
      ) = jsonb_array_length(payload -> 'files')
      and not exists (
        select 1
        from jsonb_array_elements(payload -> 'files') as requested_file
        where not exists (
          select 1
          from public.championship_import_files as imported_file
          where imported_file.batch_id = batch.id
            and imported_file.checksum = requested_file ->> 'checksum'
        )
      )
    order by batch.applied_at desc nulls last, batch.created_at desc
    limit 1;

    if target_championship_id is not null then
      match_reason := 'files';
    end if;
  end if;

  -- 3. Semantic identity for the same managed championship. This intentionally
  -- blocks a second full import with changed files: future data must go through
  -- the incremental update flow instead of creating another championship.
  if target_championship_id is null then
    select championship.id
    into target_championship_id
    from public.championships as championship
    join public.championship_club_links as link
      on link.championship_id = championship.id
     and link.club_id = target_club_id
     and link.access_role = 'manager'
    where championship.source_provider = source_provider
      and public.championship_import_normalize(championship.name) =
        public.championship_import_normalize(championship_name)
      and public.championship_import_normalize(championship.specialty) =
        public.championship_import_normalize(specialty)
      and public.championship_import_normalize(championship.season_label) =
        public.championship_import_normalize(season_label)
    order by championship.created_at
    limit 1;

    if target_championship_id is not null then
      match_reason := 'identity';
    end if;
  end if;

  if target_championship_id is not null then
    if source_external_id is not null then
      if exists (
        select 1
        from public.championships as other
        where other.source_provider = source_provider
          and other.source_external_id = source_external_id
          and other.id <> target_championship_id
      ) then
        raise exception 'Championship source is already linked to another championship'
          using errcode = '23505';
      end if;

      update public.championships as championship
      set source_external_id = coalesce(championship.source_external_id, source_external_id),
          source_url = coalesce(source_url, championship.source_url),
          updated_by = auth.uid(),
          updated_at = now()
      where championship.id = target_championship_id;
    elsif source_url is not null then
      update public.championships as championship
      set source_url = coalesce(championship.source_url, source_url),
          updated_by = auth.uid(),
          updated_at = now()
      where championship.id = target_championship_id;
    end if;

    if existing_batch_id is null then
      select batch.id, batch.summary
      into existing_batch_id, existing_summary
      from public.championship_import_batches as batch
      where batch.championship_id = target_championship_id
        and batch.club_id = target_club_id
        and batch.status = 'applied'
      order by batch.applied_at desc nulls last, batch.created_at desc
      limit 1;
    end if;

    if existing_batch_id is null then
      raise exception 'Existing championship has no applied import batch'
        using errcode = 'P0001';
    end if;

    insert into public.championship_audit_log (
      championship_id,
      club_id,
      actor_id,
      action,
      payload
    )
    values (
      target_championship_id,
      target_club_id,
      auth.uid(),
      'full_import.duplicate_blocked',
      jsonb_build_object(
        'matchReason', match_reason,
        'sourceExternalId', source_external_id,
        'sourceUrl', source_url
      )
    );

    return jsonb_build_object(
      'championshipId', target_championship_id,
      'batchId', existing_batch_id,
      'alreadyImported', true,
      'duplicateReason', match_reason,
      'summary', coalesce(existing_summary, '{}'::jsonb)
    );
  end if;

  return public.admin_import_championship_sources(payload);
end;
$$;

revoke all on function public.admin_import_championship_sources_safe(jsonb)
from public, anon, authenticated;
grant execute on function public.admin_import_championship_sources_safe(jsonb)
to authenticated;

-- Full imports from the client must go through the duplicate-safe wrapper.
revoke execute on function public.admin_import_championship_sources(jsonb)
from authenticated;
