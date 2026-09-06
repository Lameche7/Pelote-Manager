create or replace function public.admin_import_championship_sources_safe(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_club_id uuid := public.admin_current_club_id();
  v_championship_payload jsonb := payload -> 'championship';
  v_source_provider text := coalesce(
    nullif(btrim(v_championship_payload ->> 'sourceProvider'), ''),
    'ffpb'
  );
  v_source_external_id text := nullif(
    btrim(v_championship_payload ->> 'sourceExternalId'),
    ''
  );
  v_source_url text := nullif(btrim(v_championship_payload ->> 'sourceUrl'), '');
  v_championship_name text := btrim(v_championship_payload ->> 'name');
  v_specialty text := btrim(v_championship_payload ->> 'specialty');
  v_season_label text := coalesce(btrim(v_championship_payload ->> 'seasonLabel'), '');
  v_target_championship_id uuid;
  v_existing_batch_id uuid;
  v_existing_summary jsonb;
  v_match_reason text;
begin
  if not public.has_club_permission(v_target_club_id, 'championships.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if payload is null
    or jsonb_typeof(payload) <> 'object'
    or v_championship_payload is null
    or jsonb_typeof(v_championship_payload) <> 'object'
    or v_championship_name = ''
    or v_specialty = ''
    or jsonb_typeof(payload -> 'files') <> 'array'
    or jsonb_array_length(payload -> 'files') < 2
  then
    raise exception 'Championship import payload is invalid' using errcode = '22023';
  end if;

  if v_source_external_id is not null then
    select championship.id
    into v_target_championship_id
    from public.championships as championship
    where championship.source_provider = v_source_provider
      and championship.source_external_id = v_source_external_id
    limit 1;

    if v_target_championship_id is not null then
      v_match_reason := 'source';
    end if;
  end if;

  if v_target_championship_id is null then
    select batch.championship_id, batch.id, batch.summary
    into v_target_championship_id, v_existing_batch_id, v_existing_summary
    from public.championship_import_batches as batch
    join public.championship_club_links as link
      on link.championship_id = batch.championship_id
     and link.club_id = v_target_club_id
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

    if v_target_championship_id is not null then
      v_match_reason := 'files';
    end if;
  end if;

  if v_target_championship_id is null then
    select championship.id
    into v_target_championship_id
    from public.championships as championship
    join public.championship_club_links as link
      on link.championship_id = championship.id
     and link.club_id = v_target_club_id
     and link.access_role = 'manager'
    where championship.source_provider = v_source_provider
      and public.championship_import_normalize(championship.name) =
        public.championship_import_normalize(v_championship_name)
      and public.championship_import_normalize(championship.specialty) =
        public.championship_import_normalize(v_specialty)
      and public.championship_import_normalize(championship.season_label) =
        public.championship_import_normalize(v_season_label)
    order by championship.created_at
    limit 1;

    if v_target_championship_id is not null then
      v_match_reason := 'identity';
    end if;
  end if;

  if v_target_championship_id is not null then
    if v_source_external_id is not null then
      if exists (
        select 1
        from public.championships as other
        where other.source_provider = v_source_provider
          and other.source_external_id = v_source_external_id
          and other.id <> v_target_championship_id
      ) then
        raise exception 'Championship source is already linked to another championship'
          using errcode = '23505';
      end if;

      update public.championships as championship
      set source_external_id = coalesce(championship.source_external_id, v_source_external_id),
          source_url = coalesce(v_source_url, championship.source_url),
          updated_by = auth.uid(),
          updated_at = now()
      where championship.id = v_target_championship_id;
    elsif v_source_url is not null then
      update public.championships as championship
      set source_url = coalesce(championship.source_url, v_source_url),
          updated_by = auth.uid(),
          updated_at = now()
      where championship.id = v_target_championship_id;
    end if;

    if v_existing_batch_id is null then
      select batch.id, batch.summary
      into v_existing_batch_id, v_existing_summary
      from public.championship_import_batches as batch
      where batch.championship_id = v_target_championship_id
        and batch.club_id = v_target_club_id
        and batch.status = 'applied'
      order by batch.applied_at desc nulls last, batch.created_at desc
      limit 1;
    end if;

    if v_existing_batch_id is null then
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
      v_target_championship_id,
      v_target_club_id,
      auth.uid(),
      'full_import.duplicate_blocked',
      jsonb_build_object(
        'matchReason', v_match_reason,
        'sourceExternalId', v_source_external_id,
        'sourceUrl', v_source_url
      )
    );

    return jsonb_build_object(
      'championshipId', v_target_championship_id,
      'batchId', v_existing_batch_id,
      'alreadyImported', true,
      'duplicateReason', v_match_reason,
      'summary', coalesce(v_existing_summary, '{}'::jsonb)
    );
  end if;

  return public.admin_import_championship_sources(payload);
end;
$$;

revoke all on function public.admin_import_championship_sources_safe(jsonb)
from public, anon, authenticated;
grant execute on function public.admin_import_championship_sources_safe(jsonb)
to authenticated;

revoke execute on function public.admin_import_championship_sources(jsonb)
from authenticated;
