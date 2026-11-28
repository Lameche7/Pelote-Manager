-- Draft: retain the historical pool engine with explicit club authorization.
create or replace function public.admin_save_tournament_pools_for_club(
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
  pool_values jsonb := coalesce(payload->'pools', '[]'::jsonb);
  pool_item jsonb;
  team_item jsonb;
  target_series_id uuid;
  target_team_id uuid;
  target_display_order integer;
  target_size integer;
  target_pool_id uuid;
  target_team_display_order integer;
  accepted_count integer;
  assigned_count integer := 0;
  seen_team_ids uuid[] := '{}'::uuid[];
  seen_pool_keys text[] := '{}'::text[];
  pool_key text;
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

  if target_tournament.status not in ('registrations_closed', 'pools_generated') then
    raise exception 'Tournament pools are not editable at this stage'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.tournament_teams as team
    where team.tournament_id = target_tournament.id
      and team.status = 'pending'
  ) then
    raise exception 'Pending tournament teams must be resolved before pool generation'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(pool_values) <> 'array' then
    raise exception 'Tournament pool payload is invalid' using errcode = '22023';
  end if;

  select count(*)::integer
  into accepted_count
  from public.tournament_teams as team
  where team.tournament_id = target_tournament.id
    and team.status = 'accepted';

  for pool_item in
    select value from jsonb_array_elements(pool_values)
  loop
    target_series_id := nullif(pool_item->>'series_id', '')::uuid;
    target_display_order := nullif(pool_item->>'display_order', '')::integer;
    target_size := nullif(pool_item->>'target_size', '')::integer;

    if target_series_id is null
      or target_display_order is null
      or target_display_order < 0
      or target_size is null
      or target_size not in (3, 4, 5, 6)
      or jsonb_typeof(coalesce(pool_item->'teams', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(pool_item->'teams', '[]'::jsonb)) <> target_size then
      raise exception 'Tournament pool payload is invalid' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.tournament_series as series
      where series.id = target_series_id
        and series.tournament_id = target_tournament.id
        and series.enabled
    ) then
      raise exception 'Tournament pool series is invalid' using errcode = '22023';
    end if;

    pool_key := concat(target_series_id, '|', target_display_order);
    if pool_key = any(seen_pool_keys) then
      raise exception 'Tournament pool payload is invalid' using errcode = '22023';
    end if;
    seen_pool_keys := array_append(seen_pool_keys, pool_key);

    for team_item in
      select value from jsonb_array_elements(pool_item->'teams')
    loop
      target_team_id := nullif(team_item->>'team_id', '')::uuid;

      if target_team_id is null
        or target_team_id = any(seen_team_ids)
        or not exists (
          select 1
          from public.tournament_teams as team
          where team.id = target_team_id
            and team.tournament_id = target_tournament.id
            and team.series_id = target_series_id
            and team.status = 'accepted'
        ) then
        raise exception 'Tournament pool team is invalid' using errcode = '22023';
      end if;

      seen_team_ids := array_append(seen_team_ids, target_team_id);
      assigned_count := assigned_count + 1;
    end loop;
  end loop;

  if assigned_count <> accepted_count then
    raise exception 'Every accepted team must belong to exactly one pool'
      using errcode = '22023';
  end if;

  delete from public.tournament_pools
  where tournament_id = target_tournament.id;

  for pool_item in
    select value from jsonb_array_elements(pool_values)
  loop
    target_series_id := (pool_item->>'series_id')::uuid;
    target_display_order := (pool_item->>'display_order')::integer;
    target_size := (pool_item->>'target_size')::integer;

    insert into public.tournament_pools (
      tournament_id,
      series_id,
      display_order,
      target_size,
      updated_at
    )
    values (
      target_tournament.id,
      target_series_id,
      target_display_order,
      target_size,
      now()
    )
    returning id into target_pool_id;

    target_team_display_order := 0;
    for team_item in
      select value from jsonb_array_elements(pool_item->'teams')
    loop
      insert into public.tournament_pool_teams (
        pool_id,
        team_id,
        display_order
      )
      values (
        target_pool_id,
        (team_item->>'team_id')::uuid,
        coalesce(
          nullif(team_item->>'display_order', '')::integer,
          target_team_display_order
        )
      );

      target_team_display_order := target_team_display_order + 1;
    end loop;
  end loop;

  if accepted_count > 0 and not public.tournament_pools_are_complete(target_tournament.id) then
    raise exception 'Tournament pools are incomplete' using errcode = 'P0001';
  end if;

  previous_status := target_tournament.status;

  update public.tournaments
  set
    status = 'pools_generated',
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
      when previous_status = 'registrations_closed' then 'pools_generated'
      else 'pools_updated'
    end,
    previous_status,
    'pools_generated',
    jsonb_build_object(
      'pool_count', jsonb_array_length(pool_values),
      'team_count', assigned_count
    ),
    auth.uid()
  );
end;
$$;
revoke all on function public.admin_save_tournament_pools_for_club(uuid,uuid,jsonb) from public, anon, authenticated;

create or replace function public.admin_validate_tournament_pools_for_club(
  target_club_id uuid,
  target_tournament_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
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

  if target_tournament.status <> 'pools_generated' then
    raise exception 'Tournament pools cannot be validated at this stage'
      using errcode = 'P0001';
  end if;

  if not public.tournament_pools_are_complete(target_tournament.id) then
    raise exception 'Tournament pools are incomplete' using errcode = 'P0001';
  end if;

  update public.tournaments
  set
    status = 'pools_validated',
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
    'pools_validated',
    'pools_generated',
    'pools_validated',
    jsonb_build_object(
      'pool_count', (
        select count(*)
        from public.tournament_pools as pool
        where pool.tournament_id = target_tournament.id
      )
    ),
    auth.uid()
  );
end;
$$;
revoke all on function public.admin_validate_tournament_pools_for_club(uuid,uuid) from public, anon, authenticated;

create or replace function public.admin_reopen_tournament_pools_for_club(
  target_club_id uuid,
  target_tournament_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
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

  if target_tournament.status <> 'pools_validated' then
    raise exception 'Tournament pools cannot be reopened at this stage'
      using errcode = 'P0001';
  end if;

  update public.tournaments
  set
    status = 'pools_generated',
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
    'pools_reopened',
    'pools_validated',
    'pools_generated',
    '{}'::jsonb,
    auth.uid()
  );
end;
$$;
revoke all on function public.admin_reopen_tournament_pools_for_club(uuid,uuid) from public, anon, authenticated;
