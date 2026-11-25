-- Draft: explicit-club tournament listing, details and updates.
-- Existing local admin RPCs are unchanged. Apply only after isolation tests.

create or replace function public.platform_admin_list_tournaments(target_club_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;

  perform public.sync_tournament_registration_states(target_club_id);

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', tournament.id,
          'name', tournament.name,
          'season_id', tournament.season_id,
          'season_name', season.name,
          'starts_on', tournament.starts_on,
          'ends_on', tournament.ends_on,
          'pool_starts_on', tournament.pool_starts_on,
          'pool_ends_on', tournament.pool_ends_on,
          'finals_starts_on', tournament.finals_starts_on,
          'finals_ends_on', tournament.finals_ends_on,
          'registration_opens_at', tournament.registration_opens_at,
          'registration_closes_at', tournament.registration_closes_at,
          'status', tournament.status,
          'series_count', (
            select count(*)
            from public.tournament_series as series
            where series.tournament_id = tournament.id
          ),
          'resource_count', (
            select count(*)
            from public.tournament_resources as selected
            where selected.tournament_id = tournament.id
          ),
          'updated_at', tournament.updated_at
        )
        order by tournament.starts_on desc, tournament.name
      ),
      '[]'::jsonb
    )
    from public.tournaments as tournament
    join public.club_seasons as season on season.id = tournament.season_id
      and season.club_id = target_club_id
    where tournament.club_id = target_club_id
  );
end;
$$;

create or replace function public.platform_admin_get_tournament(target_club_id uuid, target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;

  perform public.sync_tournament_registration_states(target_club_id);

  select jsonb_build_object(
    'id', tournament.id,
    'name', tournament.name,
    'season_id', tournament.season_id,
    'season_name', season.name,
    'description', tournament.description,
    'rules', tournament.rules,
    'starts_on', tournament.starts_on,
    'ends_on', tournament.ends_on,
    'pool_starts_on', tournament.pool_starts_on,
    'pool_ends_on', tournament.pool_ends_on,
    'finals_starts_on', tournament.finals_starts_on,
    'finals_ends_on', tournament.finals_ends_on,
    'registration_opens_at', tournament.registration_opens_at,
    'registration_closes_at', tournament.registration_closes_at,
    'minimum_availability_slots', tournament.minimum_availability_slots,
    'minimum_weekend_availability_slots', tournament.minimum_weekend_availability_slots,
    'slot_duration_minutes', tournament.slot_duration_minutes,
    'minimum_finals_availability_slots', tournament.minimum_finals_availability_slots,
    'registration_fee_cents', tournament.registration_fee_cents,
    'status', tournament.status,
    'timezone', tournament.timezone,
    'resources', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', resource.id,
            'name', resource.name,
            'display_order', selected.display_order
          )
          order by selected.display_order, resource.name
        ),
        '[]'::jsonb
      )
      from public.tournament_resources as selected
      join public.reservable_resources as resource on resource.id = selected.resource_id
      where selected.tournament_id = tournament.id
        and resource.club_id = target_club_id
    ),
    'series', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', series.id,
            'name', series.name,
            'display_order', series.display_order,
            'capacity', series.capacity,
            'enabled', series.enabled
          )
          order by series.display_order, series.name
        ),
        '[]'::jsonb
      )
      from public.tournament_series as series
      where series.tournament_id = tournament.id
    ),
    'play_windows', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', play_window.id,
            'weekday', play_window.weekday,
            'opens_at', play_window.opens_at,
            'closes_at', play_window.closes_at,
            'display_order', play_window.display_order
          )
          order by play_window.display_order, play_window.weekday, play_window.opens_at
        ),
        '[]'::jsonb
      )
      from public.tournament_play_windows as play_window
      where play_window.tournament_id = tournament.id
    ),
    'created_at', tournament.created_at,
    'updated_at', tournament.updated_at
  )
  into result
  from public.tournaments as tournament
  join public.club_seasons as season on season.id = tournament.season_id
    and season.club_id = target_club_id
  where tournament.id = target_id
    and tournament.club_id = target_club_id;

  if result is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function pilotoki_private.platform_admin_update_tournament_core(target_club_id uuid, target_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_tournament public.tournaments;
  target_season_id uuid := nullif(payload->>'season_id', '')::uuid;
  target_name text := btrim(coalesce(payload->>'name', ''));
  target_pool_starts_on date := coalesce(
    nullif(payload->>'pool_starts_on', '')::date,
    nullif(payload->>'starts_on', '')::date
  );
  target_pool_ends_on date := coalesce(
    nullif(payload->>'pool_ends_on', '')::date,
    nullif(payload->>'ends_on', '')::date
  );
  target_finals_starts_on date := nullif(payload->>'finals_starts_on', '')::date;
  target_finals_ends_on date := nullif(payload->>'finals_ends_on', '')::date;
  target_starts_on date;
  target_ends_on date;
  target_registration_opens_at timestamptz := nullif(payload->>'registration_opens_at', '')::timestamptz;
  target_registration_closes_at timestamptz := nullif(payload->>'registration_closes_at', '')::timestamptz;
  target_minimum integer := coalesce(nullif(payload->>'minimum_availability_slots', '')::integer, 65);
  target_weekend_minimum integer := coalesce(nullif(payload->>'minimum_weekend_availability_slots', '')::integer, 0);
  target_slot_duration integer := coalesce(nullif(payload->>'slot_duration_minutes', '')::integer, 60);
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
    raise exception 'Tournament settings are locked at this stage' using errcode = 'P0001';
  end if;

  if target_name = ''
    or target_season_id is null
    or target_pool_starts_on is null
    or target_pool_ends_on is null
    or target_registration_opens_at is null
    or target_registration_closes_at is null then
    raise exception 'Tournament fields are incomplete' using errcode = '22023';
  end if;

  if target_pool_ends_on < target_pool_starts_on
    or (target_finals_starts_on is null) <> (target_finals_ends_on is null)
    or (
      target_finals_starts_on is not null
      and (
        target_finals_ends_on < target_finals_starts_on
        or target_finals_starts_on <= target_pool_ends_on
      )
    ) then
    raise exception 'Tournament phase dates are invalid' using errcode = '22023';
  end if;

  if target_registration_closes_at <= target_registration_opens_at then
    raise exception 'Registration dates are invalid' using errcode = '22023';
  end if;

  if current_tournament.status = 'registrations_open'
    and (
      target_registration_opens_at > now()
      or target_registration_closes_at <= now()
    ) then
    raise exception 'Open registration window must contain current time' using errcode = '22023';
  end if;

  if target_minimum < 0
    or target_weekend_minimum < 0
    or target_weekend_minimum > target_minimum
    or target_slot_duration < 15
    or target_slot_duration > 240 then
    raise exception 'Tournament availability settings are invalid' using errcode = '22023';
  end if;

  target_starts_on := target_pool_starts_on;
  target_ends_on := coalesce(target_finals_ends_on, target_pool_ends_on);

  if not exists (
    select 1
    from public.club_seasons as season
    where season.id = target_season_id
      and season.club_id = target_club_id
      and season.starts_on <= target_starts_on
      and season.ends_on >= target_ends_on
  ) then
    raise exception 'Tournament must fit inside its season' using errcode = '22023';
  end if;

  update public.tournaments
  set
    season_id = target_season_id,
    name = target_name,
    description = coalesce(payload->>'description', ''),
    rules = coalesce(payload->>'rules', ''),
    starts_on = target_starts_on,
    ends_on = target_ends_on,
    pool_starts_on = target_pool_starts_on,
    pool_ends_on = target_pool_ends_on,
    finals_starts_on = target_finals_starts_on,
    finals_ends_on = target_finals_ends_on,
    registration_opens_at = target_registration_opens_at,
    registration_closes_at = target_registration_closes_at,
    minimum_availability_slots = target_minimum,
    minimum_weekend_availability_slots = target_weekend_minimum,
    slot_duration_minutes = target_slot_duration,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id and club_id = target_club_id;

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

  if exists (
    select team.id
    from public.tournament_teams as team
    left join public.tournament_team_availability_slots as availability
      on availability.team_id = team.id
     and availability.tournament_id = target_id
    left join public.tournament_generated_slots(target_id) as generated
      on generated.play_date = availability.play_date
     and generated.starts_at = availability.starts_at
     and generated.ends_at = availability.ends_at
    where team.tournament_id = target_id
      and team.status in ('pending', 'accepted')
    group by team.id
    having count(availability.id) filter (
      where generated.phase = 'pools'
    ) < target_minimum
    or count(availability.id) filter (
      where generated.phase = 'pools'
        and extract(dow from availability.play_date)::integer in (0, 6)
    ) < target_weekend_minimum
  ) then
    raise exception 'Tournament availability settings conflict with existing teams'
      using errcode = 'P0001';
  end if;

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
    'updated',
    current_tournament.status,
    current_tournament.status,
    jsonb_build_object(
      'name', target_name,
      'pool_starts_on', target_pool_starts_on,
      'pool_ends_on', target_pool_ends_on,
      'finals_starts_on', target_finals_starts_on,
      'finals_ends_on', target_finals_ends_on,
      'minimum_availability_slots', target_minimum,
      'minimum_weekend_availability_slots', target_weekend_minimum,
      'slot_duration_minutes', target_slot_duration
    ),
    auth.uid()
  );
end;
$$;

create or replace function public.platform_admin_update_tournament(
  target_club_id uuid,
  target_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_minimum integer := coalesce(
    nullif(payload->>'minimum_finals_availability_slots', '')::integer,
    35
  );
  target_fee_cents integer := coalesce(
    nullif(payload->>'registration_fee_cents', '')::integer,
    0
  );
  previous_minimum integer;
  previous_fee_cents integer;
  previous_status public.tournament_status;
  active_team_id uuid;
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;
  if target_minimum < 0 then
    raise exception 'Tournament availability settings are invalid'
      using errcode = '22023';
  end if;

  if target_fee_cents < 0 then
    raise exception 'Tournament registration fee is invalid'
      using errcode = '22023';
  end if;

  select
    tournament.minimum_finals_availability_slots,
    tournament.registration_fee_cents,
    tournament.status
  into previous_minimum, previous_fee_cents, previous_status
  from public.tournaments as tournament
  where tournament.id = target_id and tournament.club_id = target_club_id
  for update;

  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if previous_fee_cents is distinct from target_fee_cents
    and previous_status not in ('preparation', 'configuration') then
    raise exception 'Tournament registration fee is locked after registrations open'
      using errcode = 'P0001';
  end if;

  perform pilotoki_private.platform_admin_update_tournament_core(target_club_id, target_id, payload);

  update public.tournaments
  set
    minimum_finals_availability_slots = target_minimum,
    registration_fee_cents = target_fee_cents,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id and club_id = target_club_id;

  for active_team_id in
    select team.id
    from public.tournament_teams as team
    where team.tournament_id = target_id
      and team.status in ('pending', 'accepted')
  loop
    perform public.assert_tournament_team_finals_availability(active_team_id);
  end loop;

  if previous_minimum is distinct from target_minimum then
    insert into public.tournament_audit_log (
      tournament_id,
      action,
      payload,
      created_by
    )
    values (
      target_id,
      'finals_availability_minimum_updated',
      jsonb_build_object(
        'before', previous_minimum,
        'after', target_minimum
      ),
      auth.uid()
    );
  end if;

  if previous_fee_cents is distinct from target_fee_cents then
    insert into public.tournament_audit_log (
      tournament_id,
      action,
      payload,
      created_by
    )
    values (
      target_id,
      'registration_fee_updated',
      jsonb_build_object(
        'before_cents', previous_fee_cents,
        'after_cents', target_fee_cents
      ),
      auth.uid()
    );
  end if;
end;
$$;

revoke all on function pilotoki_private.platform_admin_update_tournament_core(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.platform_admin_list_tournaments(uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_list_tournaments(uuid) to authenticated;
revoke all on function public.platform_admin_get_tournament(uuid, uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_get_tournament(uuid, uuid) to authenticated;
revoke all on function public.platform_admin_update_tournament(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_admin_update_tournament(uuid, uuid, jsonb) to authenticated;
