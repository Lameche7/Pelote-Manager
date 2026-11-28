-- Draft: planning operations with explicit club scope; historical rules retained.
create or replace function public.admin_prepare_tournament_matches_for_club(
  target_club_id uuid,
  target_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
  result_count integer;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
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

  if target_tournament.status not in ('pools_validated', 'planning_generated') then
    raise exception 'Tournament planning is not available at this stage'
      using errcode = 'P0001';
  end if;

  if target_tournament.status = 'pools_validated'
    and not public.tournament_pools_are_complete(target_tournament.id) then
    raise exception 'Tournament pools are incomplete' using errcode = 'P0001';
  end if;

  insert into public.tournament_matches (
    tournament_id,
    pool_id,
    series_id,
    team_a_id,
    team_b_id,
    display_order,
    status,
    updated_at
  )
  select
    pool.tournament_id,
    pool.id,
    pool.series_id,
    left_assignment.team_id,
    right_assignment.team_id,
    row_number() over (
      partition by pool.id
      order by left_assignment.display_order, right_assignment.display_order
    )::integer - 1,
    'to_schedule',
    now()
  from public.tournament_pools as pool
  join public.tournament_pool_teams as left_assignment
    on left_assignment.pool_id = pool.id
  join public.tournament_pool_teams as right_assignment
    on right_assignment.pool_id = pool.id
   and right_assignment.display_order > left_assignment.display_order
  where pool.tournament_id = target_tournament.id
  on conflict (pool_id, team_a_id, team_b_id) do nothing;

  select count(*)::integer
  into result_count
  from public.tournament_matches as match
  where match.tournament_id = target_tournament.id;

  return result_count;
end;
$$;
revoke all on function public.admin_prepare_tournament_matches_for_club(uuid,uuid) from public, anon, authenticated;

create or replace function public.admin_save_tournament_planning_for_club(
  target_club_id uuid,
  target_tournament_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
  planning_values jsonb := coalesce(payload->'planning', '[]'::jsonb);
  planning_item jsonb;
  target_match public.tournament_matches;
  target_match_id uuid;
  target_resource_id uuid;
  target_play_date date;
  target_starts_at time;
  target_ends_at time;
  target_source text;
  expected_count integer;
  assigned_count integer := 0;
  seen_match_ids uuid[] := '{}'::uuid[];
  seen_slot_keys text[] := '{}'::text[];
  seen_team_slot_keys text[] := '{}'::text[];
  slot_key text;
  team_key_a text;
  team_key_b text;
  previous_status public.tournament_status;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
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

  if target_tournament.status not in ('pools_validated', 'planning_generated') then
    raise exception 'Tournament planning is not editable at this stage'
      using errcode = 'P0001';
  end if;

  -- Serialize scoped planning saves for this club, including different tournaments.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pilotoki:club-planning:' || target_club_id::text, 0));

  if jsonb_typeof(planning_values) <> 'array' then
    raise exception 'Tournament planning payload is invalid' using errcode = '22023';
  end if;

  select count(*)::integer
  into expected_count
  from public.tournament_matches as match
  where match.tournament_id = target_tournament.id;

  if expected_count = 0 then
    raise exception 'Tournament matches have not been prepared' using errcode = 'P0001';
  end if;

  for planning_item in
    select value from jsonb_array_elements(planning_values)
  loop
    target_match_id := nullif(planning_item->>'match_id', '')::uuid;
    target_resource_id := nullif(planning_item->>'resource_id', '')::uuid;
    target_play_date := nullif(planning_item->>'play_date', '')::date;
    target_starts_at := nullif(planning_item->>'starts_at', '')::time;
    target_ends_at := nullif(planning_item->>'ends_at', '')::time;
    target_source := coalesce(nullif(planning_item->>'source', ''), 'generated');

    if target_match_id is null
      or target_resource_id is null
      or target_play_date is null
      or target_starts_at is null
      or target_ends_at is null
      or target_ends_at <= target_starts_at
      or target_source not in ('generated', 'manual')
      or target_match_id = any(seen_match_ids) then
      raise exception 'Tournament planning payload is invalid' using errcode = '22023';
    end if;

    select match.*
    into target_match
    from public.tournament_matches as match
    where match.id = target_match_id
      and match.tournament_id = target_tournament.id;

    if target_match.id is null then
      raise exception 'Tournament planning match is invalid' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.tournament_resources as selected
      join public.reservable_resources as resource on resource.id = selected.resource_id
        and resource.club_id = target_club_id
      where selected.tournament_id = target_tournament.id
        and selected.resource_id = target_resource_id
    ) then
      raise exception 'Tournament planning resource is invalid' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'pools'
        and generated.play_date = target_play_date
        and generated.starts_at = target_starts_at
        and generated.ends_at = target_ends_at
    ) then
      raise exception 'Tournament planning slot is invalid' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.tournament_team_availability_slots as availability
      where availability.tournament_id = target_tournament.id
        and availability.team_id = target_match.team_a_id
        and availability.play_date = target_play_date
        and availability.starts_at = target_starts_at
        and availability.ends_at = target_ends_at
    ) or not exists (
      select 1
      from public.tournament_team_availability_slots as availability
      where availability.tournament_id = target_tournament.id
        and availability.team_id = target_match.team_b_id
        and availability.play_date = target_play_date
        and availability.starts_at = target_starts_at
        and availability.ends_at = target_ends_at
    ) then
      raise exception 'Tournament planning violates team availability'
        using errcode = 'P0001';
    end if;

    -- Compare actual intervals, not only identical start times.
    if exists (
      select 1
      from public.tournament_match_planning as other_plan
      join public.tournaments as other_tournament on other_tournament.id = other_plan.tournament_id
      join public.tournament_matches as other_match on other_match.id = other_plan.match_id
        and other_match.tournament_id = other_tournament.id
      where other_tournament.club_id = target_club_id
        and other_tournament.id <> target_tournament.id
        and other_tournament.status not in ('cancelled', 'archived')
        and other_plan.play_date = target_play_date
        and other_plan.starts_at < target_ends_at
        and other_plan.ends_at > target_starts_at
        and (
          other_plan.resource_id = target_resource_id
          or exists (
            select 1
            from public.tournament_team_players as current_player
            join public.tournament_team_players as other_player
              on other_player.tournament_id = other_tournament.id
             and other_player.team_id in (other_match.team_a_id, other_match.team_b_id)
            left join public.tournament_external_player_identities as current_identity
              on current_identity.id = current_player.external_identity_id
             and current_identity.status = 'verified'
            left join public.tournament_external_player_identities as other_identity
              on other_identity.id = other_player.external_identity_id
             and other_identity.status = 'verified'
            where current_player.tournament_id = target_tournament.id
              and current_player.team_id in (target_match.team_a_id, target_match.team_b_id)
              and (
                current_player.member_id = other_player.member_id
                or current_player.external_identity_id = other_player.external_identity_id
                or current_identity.profile_id = other_identity.profile_id
              )
          )
        )
    ) then
      raise exception 'Tournament planning conflicts with another tournament'
        using errcode = 'P0001';
    end if;

    slot_key := concat(target_resource_id, '|', target_play_date, '|', target_starts_at);
    team_key_a := concat(target_match.team_a_id, '|', target_play_date, '|', target_starts_at);
    team_key_b := concat(target_match.team_b_id, '|', target_play_date, '|', target_starts_at);

    if slot_key = any(seen_slot_keys)
      or team_key_a = any(seen_team_slot_keys)
      or team_key_b = any(seen_team_slot_keys) then
      raise exception 'Tournament planning contains a conflict'
        using errcode = 'P0001';
    end if;

    seen_match_ids := array_append(seen_match_ids, target_match_id);
    seen_slot_keys := array_append(seen_slot_keys, slot_key);
    seen_team_slot_keys := array_append(seen_team_slot_keys, team_key_a);
    seen_team_slot_keys := array_append(seen_team_slot_keys, team_key_b);
    assigned_count := assigned_count + 1;
  end loop;

  if assigned_count <> expected_count then
    raise exception 'Every tournament match must be scheduled exactly once'
      using errcode = 'P0001';
  end if;

  delete from public.tournament_match_planning
  where tournament_id = target_tournament.id;

  update public.tournament_matches
  set status = 'to_schedule', updated_at = now()
  where tournament_id = target_tournament.id;

  for planning_item in
    select value from jsonb_array_elements(planning_values)
  loop
    target_match_id := (planning_item->>'match_id')::uuid;
    target_resource_id := (planning_item->>'resource_id')::uuid;
    target_play_date := (planning_item->>'play_date')::date;
    target_starts_at := (planning_item->>'starts_at')::time;
    target_ends_at := (planning_item->>'ends_at')::time;
    target_source := coalesce(nullif(planning_item->>'source', ''), 'generated');

    insert into public.tournament_match_planning (
      match_id,
      tournament_id,
      resource_id,
      play_date,
      starts_at,
      ends_at,
      source,
      updated_at
    )
    values (
      target_match_id,
      target_tournament.id,
      target_resource_id,
      target_play_date,
      target_starts_at,
      target_ends_at,
      target_source,
      now()
    );

    update public.tournament_matches
    set status = 'scheduled', updated_at = now()
    where id = target_match_id;
  end loop;

  previous_status := target_tournament.status;

  update public.tournaments
  set
    status = 'planning_generated',
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_tournament.id;

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
    case
      when previous_status = 'planning_generated' then 'planning_regenerated'
      else 'planning_generated'
    end,
    previous_status,
    'planning_generated',
    jsonb_build_object('match_count', assigned_count),
    auth.uid()
  );
end;
$$;
revoke all on function public.admin_save_tournament_planning_for_club(uuid,uuid,jsonb) from public, anon, authenticated;

create or replace function public.admin_update_tournament_series_colors_for_club(
  target_club_id uuid,
  target_tournament_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
  item jsonb;
  target_series_id uuid;
  target_color text;
  seen_series_ids uuid[] := '{}'::uuid[];
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
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
revoke all on function public.admin_update_tournament_series_colors_for_club(uuid,uuid,jsonb) from public, anon, authenticated;
