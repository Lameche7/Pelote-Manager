begin;

-- Les couleurs de série deviennent un paramètre de l'import configuré.
-- Elles sont appliquées dans la même transaction que l'import ou la
-- reconfiguration d'un tournoi déjà connu.
create or replace function public.admin_import_errebot_tournament_configured(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  input_file_hash text := lower(btrim(coalesce(payload->'file'->>'hash', '')));
  input_series jsonb := coalesce(payload->'series', '[]'::jsonb);
  existing_tournament_id uuid;
  existing_tournament_status public.tournament_status;
  target_tournament_id uuid;
  planning_was_unpublished boolean := false;
  import_result jsonb;
  item jsonb;
  item_name text;
  item_color text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(input_series) <> 'array'
    or exists (
      select 1
      from jsonb_array_elements(input_series) as series_item(value)
      where series_item.value ? 'color'
        and upper(btrim(coalesce(series_item.value->>'color', '')))
          !~ '^#[0-9A-F]{6}$'
    ) then
    raise exception 'Tournament series colors are invalid' using errcode = '22023';
  end if;

  if input_file_hash ~ '^[0-9a-f]{64}$' then
    select
      import_row.tournament_id,
      tournament.status
    into
      existing_tournament_id,
      existing_tournament_status
    from public.tournament_imports as import_row
    join public.tournaments as tournament
      on tournament.id = import_row.tournament_id
     and tournament.club_id = target_club_id
    where import_row.club_id = target_club_id
      and import_row.source = 'errebot'
      and import_row.source_file_hash = input_file_hash
      and import_row.status = 'imported'
      and import_row.tournament_id is not null
    order by import_row.imported_at desc nulls last, import_row.created_at desc
    limit 1
    for update of import_row, tournament;
  end if;

  if existing_tournament_id is not null then
    if existing_tournament_status = 'planning_published' then
      perform public.admin_unpublish_tournament_planning(existing_tournament_id);
      planning_was_unpublished := true;
    elsif existing_tournament_status <> 'planning_generated' then
      raise exception 'Imported Errebot tournament options are locked after publication'
        using errcode = 'P0001';
    end if;
  end if;

  import_result := public.admin_import_errebot_tournament_configured_core(payload);
  target_tournament_id := nullif(import_result->>'tournamentId', '')::uuid;

  if target_tournament_id is null then
    raise exception 'Imported tournament id is missing' using errcode = 'P0001';
  end if;

  for item in
    select value from jsonb_array_elements(input_series)
  loop
    item_name := btrim(coalesce(item->>'name', ''));
    item_color := upper(btrim(coalesce(item->>'color', '')));

    if item_color <> '' then
      update public.tournament_series as series
      set color = item_color
      where series.tournament_id = target_tournament_id
        and series.name = item_name;

      if not found then
        raise exception 'Tournament series color target not found'
          using errcode = 'P0002';
      end if;
    end if;
  end loop;

  return import_result || jsonb_build_object(
    'planningWasUnpublished', planning_was_unpublished
  );
end;
$$;

revoke all on function public.admin_import_errebot_tournament_configured(jsonb)
from public, anon, authenticated;
grant execute on function public.admin_import_errebot_tournament_configured(jsonb)
to authenticated;

-- La couleur de série est la source unique, même après publication. Les
-- événements génériques créés pour le calendrier gardent donc leur cache de
-- couleur synchronisé dans la même transaction.
create or replace function public.admin_update_tournament_series_colors(
  target_tournament_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  item jsonb;
  target_series_id uuid;
  target_color text;
  seen_series_ids uuid[] := '{}'::uuid[];
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status in ('archived', 'cancelled') then
    raise exception 'Tournament series colors are locked at this stage'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(payload) <> 'array' then
    raise exception 'Tournament series colors are invalid' using errcode = '22023';
  end if;

  perform set_config('app.allow_tournament_event_sync', 'on', true);

  for item in
    select value from jsonb_array_elements(payload)
  loop
    target_series_id := nullif(item->>'id', '')::uuid;
    target_color := upper(btrim(coalesce(item->>'color', '')));

    if target_series_id is null
      or target_color !~ '^#[0-9A-F]{6}$'
      or target_series_id = any(seen_series_ids)
      or not exists (
        select 1
        from public.tournament_series as series
        where series.id = target_series_id
          and series.tournament_id = target_tournament.id
      ) then
      raise exception 'Tournament series colors are invalid' using errcode = '22023';
    end if;

    update public.tournament_series
    set color = target_color
    where id = target_series_id
      and tournament_id = target_tournament.id;

    update public.events as event
    set
      color = target_color,
      updated_by = auth.uid(),
      updated_at = now()
    from public.tournament_match_events as match_event
    join public.tournament_matches as match
      on match.id = match_event.match_id
    where event.id = match_event.event_id
      and event.club_id = target_club_id
      and match.tournament_id = target_tournament.id
      and match.series_id = target_series_id;

    seen_series_ids := array_append(seen_series_ids, target_series_id);
  end loop;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament.id,
    'series_colors_updated',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object('series_count', cardinality(seen_series_ids)),
    auth.uid()
  );
end;
$$;

revoke all on function public.admin_update_tournament_series_colors(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.admin_update_tournament_series_colors(uuid, jsonb)
to authenticated;

-- Lecture légère des séries/couleurs disponible même après publication.
create or replace function public.admin_get_tournament_series_colors(
  target_tournament_id uuid
)
returns table (
  id uuid,
  name text,
  color text,
  display_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
      and tournament.club_id = target_club_id
  ) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return query
  select
    series.id,
    series.name,
    series.color,
    series.display_order
  from public.tournament_series as series
  where series.tournament_id = target_tournament_id
    and series.enabled
  order by series.display_order, series.name;
end;
$$;

revoke all on function public.admin_get_tournament_series_colors(uuid)
from public, anon, authenticated;
grant execute on function public.admin_get_tournament_series_colors(uuid)
to authenticated;

-- Projection publique minimale pour décorer les vues Réservations du jour / 7 jours
-- du Mode TV sans modifier le payload historique du grand RPC TV.
create or replace function public.get_public_tv_tournament_slot_colors(
  target_token uuid
)
returns table (
  resource_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  series_name text,
  display_color text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    occupation.resource_id,
    occupation.starts_at,
    occupation.ends_at,
    series.name as series_name,
    series.color as display_color
  from public.club_tv_settings as settings
  join public.club_tv_resources as selected_resource
    on selected_resource.club_id = settings.club_id
  join public.calendar_occupations as occupation
    on occupation.resource_id = selected_resource.resource_id
   and occupation.cancelled_at is null
  join public.event_resources as event_resource
    on event_resource.calendar_occupation_id = occupation.id
  join public.tournament_match_events as match_event
    on match_event.event_id = event_resource.event_id
  join public.tournament_matches as match
    on match.id = match_event.match_id
  join public.tournaments as tournament
    on tournament.id = match.tournament_id
   and tournament.club_id = settings.club_id
  join public.tournament_series as series
    on series.id = match.series_id
   and series.tournament_id = tournament.id
  where settings.public_token = target_token
    and settings.is_enabled
    and occupation.ends_at > (
      ((now() at time zone 'Europe/Paris')::date)::timestamp
      at time zone 'Europe/Paris'
    )
    and occupation.starts_at < (
      (((now() at time zone 'Europe/Paris')::date + 7)::timestamp)
      at time zone 'Europe/Paris'
    )
  order by occupation.starts_at, occupation.resource_id;
$$;

revoke all on function public.get_public_tv_tournament_slot_colors(uuid)
from public;
grant execute on function public.get_public_tv_tournament_slot_colors(uuid)
to anon, authenticated;

commit;
