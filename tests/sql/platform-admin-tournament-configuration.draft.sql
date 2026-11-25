-- Draft: explicit club scope for tournament setup and registration transitions.
-- Existing local admin RPCs are not replaced.

create or replace function public.platform_admin_save_tournament_configuration(target_club_id uuid, target_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tournament public.tournaments;
  resource_ids jsonb := coalesce(payload->'resource_ids', '[]'::jsonb);
  series_values jsonb := coalesce(payload->'series', '[]'::jsonb);
  play_window_values jsonb := coalesce(payload->'play_windows', '[]'::jsonb);
  requested_resource_count integer;
  distinct_resource_count integer;
  valid_resource_count integer;
  requested_series_ids uuid[] := '{}'::uuid[];
  existing_series record;
  item jsonb;
  item_index integer := 0;
  item_id uuid;
  item_name text;
  item_capacity integer;
  item_enabled boolean;
  item_weekday integer;
  item_opens_at time;
  item_closes_at time;
  active_team_count integer;
  seen_names text[] := '{}'::text[];
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;

  select tournament.*
  into current_tournament
  from public.tournaments as tournament
  where tournament.id = target_id
    and tournament.club_id = target_club_id
  for update;

  if current_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if current_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed'
  ) then
    raise exception 'Tournament configuration is locked at this stage' using errcode = 'P0001';
  end if;

  if jsonb_typeof(resource_ids) <> 'array'
    or jsonb_typeof(series_values) <> 'array'
    or jsonb_typeof(play_window_values) <> 'array' then
    raise exception 'Tournament configuration is invalid' using errcode = '22023';
  end if;

  select count(*), count(distinct value)
  into requested_resource_count, distinct_resource_count
  from jsonb_array_elements_text(resource_ids);

  if requested_resource_count <> distinct_resource_count then
    raise exception 'A resource can only be selected once' using errcode = '22023';
  end if;

  select count(*)
  into valid_resource_count
  from public.reservable_resources as resource
  where resource.club_id = target_club_id
    and resource.is_active
    and resource.id in (
      select value::uuid
      from jsonb_array_elements_text(resource_ids)
    );

  if valid_resource_count <> requested_resource_count then
    raise exception 'One or more resources are invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg((value->>'id')::uuid), '{}'::uuid[])
  into requested_series_ids
  from jsonb_array_elements(series_values)
  where nullif(value->>'id', '') is not null;

  if exists (
    select 1
    from unnest(requested_series_ids) as requested(id)
    left join public.tournament_series as series
      on series.id = requested.id
     and series.tournament_id = target_id
    where series.id is null
  ) then
    raise exception 'Tournament series are invalid' using errcode = '22023';
  end if;

  for existing_series in
    select series.id
    from public.tournament_series as series
    where series.tournament_id = target_id
      and not (series.id = any(requested_series_ids))
  loop
    if exists (
      select 1
      from public.tournament_teams as team
      where team.series_id = existing_series.id
    ) then
      raise exception 'Tournament series with teams cannot be removed'
        using errcode = 'P0001';
    end if;
  end loop;

  delete from public.tournament_series as series
  where series.tournament_id = target_id
    and not (series.id = any(requested_series_ids));

  if cardinality(requested_series_ids) > 0 then
    update public.tournament_series as series
    set name = concat('__editing__', replace(series.id::text, '-', ''))
    where series.tournament_id = target_id
      and series.id = any(requested_series_ids);
  end if;

  item_index := 0;
  for item in select value from jsonb_array_elements(series_values)
  loop
    item_id := nullif(item->>'id', '')::uuid;
    item_name := btrim(coalesce(item->>'name', ''));
    item_capacity := coalesce(nullif(item->>'capacity', '')::integer, 0);
    item_enabled := coalesce(nullif(item->>'enabled', '')::boolean, true);

    if item_name = ''
      or lower(item_name) = any(seen_names)
      or item_capacity < 0
      or (item_enabled and item_capacity = 0) then
      raise exception 'Tournament series are invalid' using errcode = '22023';
    end if;

    seen_names := array_append(seen_names, lower(item_name));

    if item_id is not null then
      select count(*)::integer
      into active_team_count
      from public.tournament_teams as team
      where team.series_id = item_id
        and team.status in ('pending', 'accepted');

      if item_capacity < active_team_count
        or (not item_enabled and active_team_count > 0) then
        raise exception 'Tournament series capacity conflicts with existing teams'
          using errcode = 'P0001';
      end if;

      update public.tournament_series
      set
        name = item_name,
        display_order = coalesce(nullif(item->>'display_order', '')::integer, item_index),
        capacity = item_capacity,
        enabled = item_enabled
      where id = item_id
        and tournament_id = target_id;
    else
      insert into public.tournament_series (
        tournament_id,
        name,
        display_order,
        capacity,
        enabled
      )
      values (
        target_id,
        item_name,
        coalesce(nullif(item->>'display_order', '')::integer, item_index),
        item_capacity,
        item_enabled
      );
    end if;

    item_index := item_index + 1;
  end loop;

  delete from public.tournament_resources
  where tournament_id = target_id;

  insert into public.tournament_resources (tournament_id, resource_id, display_order)
  select
    target_id,
    value::uuid,
    (ordinality - 1)::integer
  from jsonb_array_elements_text(resource_ids) with ordinality as resources(value, ordinality);

  delete from public.tournament_play_windows
  where tournament_id = target_id;

  item_index := 0;
  for item in select value from jsonb_array_elements(play_window_values)
  loop
    item_weekday := nullif(item->>'weekday', '')::integer;
    item_opens_at := nullif(item->>'opens_at', '')::time;
    item_closes_at := nullif(item->>'closes_at', '')::time;

    if item_weekday is null
      or item_weekday < 0
      or item_weekday > 6
      or item_opens_at is null
      or item_closes_at is null
      or item_closes_at <= item_opens_at then
      raise exception 'Tournament play windows are invalid' using errcode = '22023';
    end if;

    insert into public.tournament_play_windows (
      tournament_id,
      weekday,
      opens_at,
      closes_at,
      display_order
    )
    values (
      target_id,
      item_weekday,
      item_opens_at,
      item_closes_at,
      coalesce(nullif(item->>'display_order', '')::integer, item_index)
    );

    item_index := item_index + 1;
  end loop;

  if exists (
    select 1
    from public.tournament_team_availability_slots as availability
    join public.tournament_teams as team on team.id = availability.team_id
    where team.tournament_id = target_id
      and team.status in ('pending', 'accepted')
      and not exists (
        select 1
        from public.tournament_generated_slots(target_id) as generated
        where generated.play_date = availability.play_date
          and generated.starts_at = availability.starts_at
          and generated.ends_at = availability.ends_at
      )
  ) then
    raise exception 'Tournament configuration would invalidate existing availability'
      using errcode = 'P0001';
  end if;

  update public.tournaments
  set
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id and club_id = target_club_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_id,
    'configuration_saved',
    current_tournament.status,
    current_tournament.status,
    jsonb_build_object(
      'resource_count', requested_resource_count,
      'series_count', jsonb_array_length(series_values),
      'play_window_count', jsonb_array_length(play_window_values)
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.platform_admin_save_tournament_configuration(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_admin_save_tournament_configuration(uuid, uuid, jsonb) to authenticated;

create or replace function public.platform_admin_transition_tournament(target_club_id uuid, 
  target_id uuid,
  target_status public.tournament_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tournament public.tournaments;
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;

  select tournament.*
  into current_tournament
  from public.tournaments as tournament
  where tournament.id = target_id
    and tournament.club_id = target_club_id
  for update;

  if current_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_status = 'configuration' then
    if current_tournament.status <> 'preparation' then
      raise exception 'Invalid tournament transition' using errcode = 'P0001';
    end if;
    if not public.tournament_configuration_is_complete(target_id) then
      raise exception 'Complete resources, series and play windows first' using errcode = 'P0001';
    end if;
  elsif target_status = 'registrations_open' then
    if current_tournament.status <> 'configuration' then
      raise exception 'Invalid tournament transition' using errcode = 'P0001';
    end if;
    if not public.tournament_configuration_is_complete(target_id) then
      raise exception 'Tournament configuration is incomplete' using errcode = 'P0001';
    end if;
    if now() < current_tournament.registration_opens_at
      or now() >= current_tournament.registration_closes_at then
      raise exception 'Registration window is not open' using errcode = 'P0001';
    end if;
  elsif target_status = 'registrations_closed' then
    if current_tournament.status <> 'registrations_open' then
      raise exception 'Invalid tournament transition' using errcode = 'P0001';
    end if;
  elsif target_status = 'cancelled' then
    if current_tournament.status not in (
      'preparation',
      'configuration',
      'registrations_open',
      'registrations_closed'
    ) then
      raise exception 'Tournament cannot be cancelled by the core engine at this stage' using errcode = 'P0001';
    end if;
  else
    raise exception 'Transition belongs to a future tournament engine' using errcode = 'P0001';
  end if;

  update public.tournaments
  set
    status = target_status,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id and club_id = target_club_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_id,
    'status_changed',
    current_tournament.status,
    target_status,
    '{}'::jsonb,
    auth.uid()
  );
end;
$$;

revoke all on function public.platform_admin_transition_tournament(uuid, uuid, public.tournament_status) from public, anon, authenticated;
grant execute on function public.platform_admin_transition_tournament(uuid, uuid, public.tournament_status) to authenticated;

