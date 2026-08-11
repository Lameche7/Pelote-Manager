begin;

-- PR69 — phases de tournoi, disponibilités de phase finale et configuration
-- administrable jusqu'à la génération des poules.

alter table public.tournaments
add column if not exists pool_starts_on date;

alter table public.tournaments
add column if not exists pool_ends_on date;

alter table public.tournaments
add column if not exists finals_starts_on date;

alter table public.tournaments
add column if not exists finals_ends_on date;

update public.tournaments
set
  pool_starts_on = coalesce(pool_starts_on, starts_on),
  pool_ends_on = coalesce(pool_ends_on, ends_on)
where pool_starts_on is null
   or pool_ends_on is null;

alter table public.tournaments
alter column pool_starts_on set not null;

alter table public.tournaments
alter column pool_ends_on set not null;

alter table public.tournaments
drop constraint if exists tournaments_phase_dates_check;

alter table public.tournaments
add constraint tournaments_phase_dates_check
check (
  pool_ends_on >= pool_starts_on
  and (
    (finals_starts_on is null and finals_ends_on is null)
    or (
      finals_starts_on is not null
      and finals_ends_on is not null
      and finals_ends_on >= finals_starts_on
      and finals_starts_on > pool_ends_on
    )
  )
);

create or replace function public.tournament_generated_slots(
  target_tournament_id uuid
)
returns table (
  play_date date,
  starts_at time,
  ends_at time,
  phase text
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select
      tournament.id,
      tournament.pool_starts_on,
      tournament.pool_ends_on,
      tournament.finals_starts_on,
      tournament.finals_ends_on,
      make_interval(mins => tournament.slot_duration_minutes) as slot_interval
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
  ),
  phases as (
    select
      target.id as tournament_id,
      target.pool_starts_on as starts_on,
      target.pool_ends_on as ends_on,
      target.slot_interval,
      'pools'::text as phase
    from target
    union all
    select
      target.id,
      target.finals_starts_on,
      target.finals_ends_on,
      target.slot_interval,
      'finals'::text
    from target
    where target.finals_starts_on is not null
      and target.finals_ends_on is not null
  )
  select distinct
    date_series.play_timestamp::date as play_date,
    slot_series.starts_at::time as starts_at,
    (slot_series.starts_at + phases.slot_interval)::time as ends_at,
    phases.phase
  from phases
  cross join lateral generate_series(
    phases.starts_on::timestamp,
    phases.ends_on::timestamp,
    interval '1 day'
  ) as date_series(play_timestamp)
  join public.tournament_play_windows as play_window
    on play_window.tournament_id = phases.tournament_id
   and play_window.weekday = extract(dow from date_series.play_timestamp)::integer
  cross join lateral generate_series(
    date_series.play_timestamp::date + play_window.opens_at,
    date_series.play_timestamp::date + play_window.closes_at - phases.slot_interval,
    phases.slot_interval
  ) as slot_series(starts_at)
  order by play_date, starts_at, ends_at, phase;
$$;

revoke all on function public.tournament_generated_slots(uuid)
from public, anon, authenticated;

create or replace function public.admin_list_tournaments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
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
    where tournament.club_id = target_club_id
  );
end;
$$;

create or replace function public.admin_get_tournament(target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  result jsonb;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
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
  where tournament.id = target_id
    and tournament.club_id = target_club_id;

  if result is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function public.admin_create_tournament(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_id uuid;
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
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
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

  insert into public.tournaments (
    club_id,
    season_id,
    name,
    description,
    rules,
    starts_on,
    ends_on,
    pool_starts_on,
    pool_ends_on,
    finals_starts_on,
    finals_ends_on,
    registration_opens_at,
    registration_closes_at,
    minimum_availability_slots,
    minimum_weekend_availability_slots,
    slot_duration_minutes,
    created_by,
    updated_by
  )
  values (
    target_club_id,
    target_season_id,
    target_name,
    coalesce(payload->>'description', ''),
    coalesce(payload->>'rules', ''),
    target_starts_on,
    target_ends_on,
    target_pool_starts_on,
    target_pool_ends_on,
    target_finals_starts_on,
    target_finals_ends_on,
    target_registration_opens_at,
    target_registration_closes_at,
    target_minimum,
    target_weekend_minimum,
    target_slot_duration,
    auth.uid(),
    auth.uid()
  )
  returning id into target_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    after_status,
    payload,
    created_by
  )
  values (
    target_id,
    'created',
    'preparation',
    jsonb_build_object(
      'name', target_name,
      'pool_starts_on', target_pool_starts_on,
      'pool_ends_on', target_pool_ends_on,
      'finals_starts_on', target_finals_starts_on,
      'finals_ends_on', target_finals_ends_on
    ),
    auth.uid()
  );

  return target_id;
end;
$$;

create or replace function public.admin_update_tournament(target_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
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
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
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
  where id = target_id;

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

create or replace function public.admin_save_tournament_configuration(target_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
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
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
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
  where id = target_id;

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

create or replace function public.get_public_tournament_availability_grid(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.status not in ('preparation', 'configuration', 'cancelled');

  if target_tournament.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'minimum_total', target_tournament.minimum_availability_slots,
    'minimum_weekend', target_tournament.minimum_weekend_availability_slots,
    'slot_duration_minutes', target_tournament.slot_duration_minutes,
    'pool_starts_on', target_tournament.pool_starts_on,
    'pool_ends_on', target_tournament.pool_ends_on,
    'finals_starts_on', target_tournament.finals_starts_on,
    'finals_ends_on', target_tournament.finals_ends_on,
    'available_pool_slot_count', (
      select count(*)
      from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'pools'
    ),
    'available_finals_slot_count', (
      select count(*)
      from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'finals'
    ),
    'slots', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'play_date', generated.play_date,
            'starts_at', generated.starts_at,
            'ends_at', generated.ends_at,
            'phase', generated.phase
          )
          order by
            case generated.phase when 'pools' then 0 else 1 end,
            generated.play_date,
            generated.starts_at,
            generated.ends_at
        ),
        '[]'::jsonb
      )
      from public.tournament_generated_slots(target_tournament.id) as generated
    )
  );
end;
$$;

create or replace function public.get_my_tournament_registration_v2(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_registration jsonb;
  target_team_id uuid;
begin
  base_registration := public.get_my_tournament_registration(target_tournament_id);

  if base_registration is null then
    return null;
  end if;

  target_team_id := nullif(base_registration->>'id', '')::uuid;

  return base_registration || jsonb_build_object(
    'availability_slots', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'play_date', availability.play_date,
            'starts_at', availability.starts_at,
            'ends_at', availability.ends_at,
            'phase', generated.phase
          )
          order by availability.play_date, availability.starts_at, availability.ends_at
        ),
        '[]'::jsonb
      )
      from public.tournament_team_availability_slots as availability
      left join public.tournament_generated_slots(target_tournament_id) as generated
        on generated.play_date = availability.play_date
       and generated.starts_at = availability.starts_at
       and generated.ends_at = availability.ends_at
      where availability.team_id = target_team_id
        and availability.tournament_id = target_tournament_id
    )
  );
end;
$$;

create or replace function public.save_my_tournament_registration_v2(
  target_tournament_id uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  target_tournament public.tournaments;
  availability_payload jsonb := coalesce(payload->'availability_slots', '[]'::jsonb);
  availability_item jsonb;
  availability_date date;
  availability_starts_at time;
  availability_ends_at time;
  availability_phase text;
  slot_key text;
  seen_keys text[] := '{}'::text[];
  pool_selected_count integer := 0;
  pool_weekend_count integer := 0;
  finals_selected_count integer := 0;
  target_team_id uuid;
begin
  if target_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(availability_payload) <> 'array' then
    raise exception 'Tournament availability slots are invalid'
      using errcode = '22023';
  end if;

  for availability_item in
    select value from jsonb_array_elements(availability_payload)
  loop
    if coalesce(availability_item->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(availability_item->>'starts_at', '') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
      or coalesce(availability_item->>'ends_at', '') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then
      raise exception 'Tournament availability slots are invalid'
        using errcode = '22023';
    end if;

    availability_date := (availability_item->>'date')::date;
    availability_starts_at := (availability_item->>'starts_at')::time;
    availability_ends_at := (availability_item->>'ends_at')::time;
    slot_key := concat(
      availability_date,
      '|',
      availability_starts_at,
      '|',
      availability_ends_at
    );

    if slot_key = any(seen_keys) then
      raise exception 'Tournament availability slots are invalid'
        using errcode = '22023';
    end if;
    seen_keys := array_append(seen_keys, slot_key);

    select generated.phase
    into availability_phase
    from public.tournament_generated_slots(target_tournament_id) as generated
    where generated.play_date = availability_date
      and generated.starts_at = availability_starts_at
      and generated.ends_at = availability_ends_at
    limit 1;

    if availability_phase is null then
      raise exception 'Tournament availability slots are invalid'
        using errcode = '22023';
    end if;

    if availability_phase = 'pools' then
      pool_selected_count := pool_selected_count + 1;
      if extract(dow from availability_date)::integer in (0, 6) then
        pool_weekend_count := pool_weekend_count + 1;
      end if;
    else
      finals_selected_count := finals_selected_count + 1;
    end if;
  end loop;

  if pool_selected_count < target_tournament.minimum_availability_slots then
    raise exception 'Tournament availability minimum not reached'
      using errcode = '22023';
  end if;

  if pool_weekend_count < target_tournament.minimum_weekend_availability_slots then
    raise exception 'Tournament weekend availability minimum not reached'
      using errcode = '22023';
  end if;

  target_team_id := public.save_my_tournament_registration(
    target_tournament_id,
    payload || jsonb_build_object('availability_rules', '[]'::jsonb)
  );

  delete from public.tournament_team_availability_slots
  where team_id = target_team_id;

  insert into public.tournament_team_availability_slots (
    team_id,
    tournament_id,
    play_date,
    starts_at,
    ends_at
  )
  select
    target_team_id,
    target_tournament_id,
    (item.value->>'date')::date,
    (item.value->>'starts_at')::time,
    (item.value->>'ends_at')::time
  from jsonb_array_elements(availability_payload) as item(value);

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament_id,
    'team_availability_slots_saved',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'team_id', target_team_id,
      'pool_slot_count', pool_selected_count,
      'pool_weekend_slot_count', pool_weekend_count,
      'finals_slot_count', finals_selected_count
    ),
    target_user_id
  );

  return target_team_id;
end;
$$;

create or replace function public.admin_get_tournament_dated_availability(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'minimum_total', target_tournament.minimum_availability_slots,
    'minimum_weekend', target_tournament.minimum_weekend_availability_slots,
    'slot_duration_minutes', target_tournament.slot_duration_minutes,
    'pool_starts_on', target_tournament.pool_starts_on,
    'pool_ends_on', target_tournament.pool_ends_on,
    'finals_starts_on', target_tournament.finals_starts_on,
    'finals_ends_on', target_tournament.finals_ends_on,
    'available_slot_count', (
      select count(*) from public.tournament_generated_slots(target_tournament.id)
    ),
    'available_weekend_slot_count', (
      select count(*)
      from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'pools'
        and extract(dow from generated.play_date)::integer in (0, 6)
    ),
    'available_pool_slot_count', (
      select count(*)
      from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'pools'
    ),
    'available_finals_slot_count', (
      select count(*)
      from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'finals'
    ),
    'slots', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'play_date', generated.play_date,
            'starts_at', generated.starts_at,
            'ends_at', generated.ends_at,
            'phase', generated.phase
          )
          order by
            case generated.phase when 'pools' then 0 else 1 end,
            generated.play_date,
            generated.starts_at
        ),
        '[]'::jsonb
      )
      from public.tournament_generated_slots(target_tournament.id) as generated
    ),
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'team_id', stats.team_id,
            'slot_count', stats.slot_count,
            'weekend_slot_count', stats.pool_weekend_slot_count,
            'pool_slot_count', stats.pool_slot_count,
            'finals_slot_count', stats.finals_slot_count
          )
          order by stats.team_id
        ),
        '[]'::jsonb
      )
      from (
        select
          team.id as team_id,
          count(availability.id)::integer as slot_count,
          count(availability.id) filter (
            where generated.phase = 'pools'
          )::integer as pool_slot_count,
          count(availability.id) filter (
            where generated.phase = 'finals'
          )::integer as finals_slot_count,
          count(availability.id) filter (
            where generated.phase = 'pools'
              and extract(dow from availability.play_date)::integer in (0, 6)
          )::integer as pool_weekend_slot_count
        from public.tournament_teams as team
        left join public.tournament_team_availability_slots as availability
          on availability.team_id = team.id
         and availability.tournament_id = target_tournament.id
        left join public.tournament_generated_slots(target_tournament.id) as generated
          on generated.play_date = availability.play_date
         and generated.starts_at = availability.starts_at
         and generated.ends_at = availability.ends_at
        where team.tournament_id = target_tournament.id
        group by team.id
      ) as stats
    )
  );
end;
$$;

create or replace function public.admin_get_tournament_team_dated_availability(
  target_team_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_team public.tournament_teams;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select team.*
  into target_team
  from public.tournament_teams as team
  join public.tournaments as tournament on tournament.id = team.tournament_id
  where team.id = target_team_id
    and tournament.club_id = target_club_id;

  if target_team.id is null then
    raise exception 'Tournament team not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'team_id', target_team.id,
    'tournament_id', target_team.tournament_id,
    'slots', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'play_date', availability.play_date,
            'starts_at', availability.starts_at,
            'ends_at', availability.ends_at,
            'phase', generated.phase
          )
          order by availability.play_date, availability.starts_at, availability.ends_at
        ),
        '[]'::jsonb
      )
      from public.tournament_team_availability_slots as availability
      left join public.tournament_generated_slots(target_team.tournament_id) as generated
        on generated.play_date = availability.play_date
       and generated.starts_at = availability.starts_at
       and generated.ends_at = availability.ends_at
      where availability.team_id = target_team.id
        and availability.tournament_id = target_team.tournament_id
    )
  );
end;
$$;

create or replace function public.admin_save_tournament_team_v2(
  target_tournament_id uuid,
  target_team_id uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  availability_payload jsonb := coalesce(payload->'availability_slots', '[]'::jsonb);
  availability_item jsonb;
  availability_date date;
  availability_starts_at time;
  availability_ends_at time;
  availability_phase text;
  slot_key text;
  seen_keys text[] := '{}'::text[];
  pool_selected_count integer := 0;
  pool_weekend_count integer := 0;
  finals_selected_count integer := 0;
  saved_team_id uuid;
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

  if target_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed'
  ) then
    raise exception 'Tournament teams are locked at this stage'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(availability_payload) <> 'array' then
    raise exception 'Tournament availability slots are invalid'
      using errcode = '22023';
  end if;

  for availability_item in
    select value from jsonb_array_elements(availability_payload)
  loop
    if coalesce(availability_item->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(availability_item->>'starts_at', '') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
      or coalesce(availability_item->>'ends_at', '') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then
      raise exception 'Tournament availability slots are invalid'
        using errcode = '22023';
    end if;

    availability_date := (availability_item->>'date')::date;
    availability_starts_at := (availability_item->>'starts_at')::time;
    availability_ends_at := (availability_item->>'ends_at')::time;
    slot_key := concat(
      availability_date,
      '|',
      availability_starts_at,
      '|',
      availability_ends_at
    );

    if slot_key = any(seen_keys) then
      raise exception 'Tournament availability slots are invalid'
        using errcode = '22023';
    end if;
    seen_keys := array_append(seen_keys, slot_key);

    select generated.phase
    into availability_phase
    from public.tournament_generated_slots(target_tournament.id) as generated
    where generated.play_date = availability_date
      and generated.starts_at = availability_starts_at
      and generated.ends_at = availability_ends_at
    limit 1;

    if availability_phase is null then
      raise exception 'Tournament availability slots are invalid'
        using errcode = '22023';
    end if;

    if availability_phase = 'pools' then
      pool_selected_count := pool_selected_count + 1;
      if extract(dow from availability_date)::integer in (0, 6) then
        pool_weekend_count := pool_weekend_count + 1;
      end if;
    else
      finals_selected_count := finals_selected_count + 1;
    end if;
  end loop;

  if pool_selected_count < target_tournament.minimum_availability_slots then
    raise exception 'Tournament availability minimum not reached'
      using errcode = '22023';
  end if;

  if pool_weekend_count < target_tournament.minimum_weekend_availability_slots then
    raise exception 'Tournament weekend availability minimum not reached'
      using errcode = '22023';
  end if;

  saved_team_id := public.admin_save_tournament_team(
    target_tournament_id,
    target_team_id,
    payload || jsonb_build_object('availability_rules', '[]'::jsonb)
  );

  delete from public.tournament_team_availability_slots
  where team_id = saved_team_id
    and tournament_id = target_tournament.id;

  insert into public.tournament_team_availability_slots (
    team_id,
    tournament_id,
    play_date,
    starts_at,
    ends_at
  )
  select
    saved_team_id,
    target_tournament.id,
    (item.value->>'date')::date,
    (item.value->>'starts_at')::time,
    (item.value->>'ends_at')::time
  from jsonb_array_elements(availability_payload) as item(value);

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
    'team_availability_slots_saved_by_admin',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'team_id', saved_team_id,
      'pool_slot_count', pool_selected_count,
      'pool_weekend_slot_count', pool_weekend_count,
      'finals_slot_count', finals_selected_count
    ),
    auth.uid()
  );

  return saved_team_id;
end;
$$;

create or replace function public.generate_tournament_test_data(
  target_tournament_id uuid,
  target_teams_per_series integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
  target_batch_id uuid := gen_random_uuid();
  series_row record;
  team_index integer;
  global_index integer := 0;
  existing_active_count integer;
  series_created_count integer;
  total_created_count integer := 0;
  available_pool_slot_count integer := 0;
  available_pool_weekend_slot_count integer := 0;
  available_finals_slot_count integer := 0;
  target_pool_count integer;
  target_finals_count integer;
  selected_pool_count integer;
  additional_pool_count integer;
  availability_ratio numeric;
  finals_ratio numeric;
  availability_profile text;
  target_team_id uuid;
  front_first_name text;
  front_last_name text;
  back_first_name text;
  back_last_name text;
  generated_email text;
  generated_phone text;
  series_summary jsonb := '[]'::jsonb;
  first_names text[] := array[
    'Antton', 'Baptiste', 'Beñat', 'Clément', 'Dorian', 'Eneko',
    'Fabien', 'Gaël', 'Iban', 'Jon', 'Julien', 'Kévin',
    'Léo', 'Mathieu', 'Mikel', 'Nicolas', 'Oier', 'Paul',
    'Peio', 'Pierre', 'Rémi', 'Thomas', 'Txomin', 'Xabi'
  ];
  last_names text[] := array[
    'Aguirre', 'Aramburu', 'Bidegain', 'Carricart', 'Darrieutort',
    'Duhalde', 'Etcheber', 'Etcheverry', 'Garcia', 'Harguindeguy',
    'Hiriart', 'Irigoyen', 'Lacoste', 'Larralde', 'Larrieu',
    'Maitia', 'Olçomendy', 'Oyhenart', 'Sallaberry', 'Urrutia'
  ];
begin
  if target_tournament_id is null then
    raise exception 'Tournament id is required' using errcode = '22023';
  end if;

  if target_teams_per_series is null
    or target_teams_per_series < 1
    or target_teams_per_series > 64 then
    raise exception 'Test teams per series must be between 1 and 64'
      using errcode = '22023';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed'
  ) then
    raise exception 'Tournament test data are locked at this stage'
      using errcode = 'P0001';
  end if;

  select
    count(*) filter (where generated.phase = 'pools')::integer,
    count(*) filter (
      where generated.phase = 'pools'
        and extract(dow from generated.play_date)::integer in (0, 6)
    )::integer,
    count(*) filter (where generated.phase = 'finals')::integer
  into
    available_pool_slot_count,
    available_pool_weekend_slot_count,
    available_finals_slot_count
  from public.tournament_generated_slots(target_tournament.id) as generated;

  if available_pool_slot_count < target_tournament.minimum_availability_slots then
    raise exception 'Tournament does not contain enough pool slots for test registrations'
      using errcode = 'P0001';
  end if;

  if available_pool_weekend_slot_count < target_tournament.minimum_weekend_availability_slots then
    raise exception 'Tournament does not contain enough weekend pool slots for test registrations'
      using errcode = 'P0001';
  end if;

  insert into public.tournament_test_data_batches (
    id,
    tournament_id,
    teams_per_series,
    created_by
  )
  values (
    target_batch_id,
    target_tournament.id,
    target_teams_per_series,
    auth.uid()
  );

  for series_row in
    select
      series.id,
      series.name,
      series.capacity,
      series.display_order
    from public.tournament_series as series
    where series.tournament_id = target_tournament.id
      and series.enabled
      and series.capacity > 0
    order by series.display_order, series.name
  loop
    select count(*)::integer
    into existing_active_count
    from public.tournament_teams as team
    where team.series_id = series_row.id
      and team.status in ('pending', 'accepted');

    series_created_count := least(
      target_teams_per_series,
      greatest(series_row.capacity - existing_active_count, 0)
    );

    if series_created_count > 0 then
      for team_index in 1..series_created_count
      loop
        global_index := global_index + 1;

        front_first_name := first_names[
          1 + floor(random() * array_length(first_names, 1))::integer
        ];
        back_first_name := first_names[
          1 + floor(random() * array_length(first_names, 1))::integer
        ];
        front_last_name := concat(
          last_names[
            1 + floor(random() * array_length(last_names, 1))::integer
          ],
          ' TEST',
          lpad(global_index::text, 3, '0')
        );
        back_last_name := concat(
          last_names[
            1 + floor(random() * array_length(last_names, 1))::integer
          ],
          ' TEST',
          lpad(global_index::text, 3, '0')
        );

        generated_email := format(
          'tournoi-test-%s-%s@example.test',
          substring(replace(target_batch_id::text, '-', '') from 1 for 8),
          global_index
        );
        generated_phone := concat(
          '0600',
          lpad((global_index % 1000000)::text, 6, '0')
        );

        case global_index % 4
          when 0 then
            availability_profile := 'minimum';
            availability_ratio := 0;
            finals_ratio := 0.50;
          when 1 then
            availability_profile := 'contraint';
            availability_ratio := 0.65;
            finals_ratio := 0.65;
          when 2 then
            availability_profile := 'standard';
            availability_ratio := 0.80;
            finals_ratio := 0.80;
          else
            availability_profile := 'large';
            availability_ratio := 0.95;
            finals_ratio := 0.95;
        end case;

        target_pool_count := least(
          available_pool_slot_count,
          greatest(
            target_tournament.minimum_availability_slots,
            ceil(available_pool_slot_count * availability_ratio)::integer
          )
        );
        target_finals_count := case
          when available_finals_slot_count = 0 then 0
          else least(
            available_finals_slot_count,
            greatest(1, ceil(available_finals_slot_count * finals_ratio)::integer)
          )
        end;

        insert into public.tournament_teams (
          tournament_id,
          series_id,
          status,
          contact_email,
          contact_phone,
          comments,
          submitted_by,
          created_by,
          validated_by,
          validated_at
        )
        values (
          target_tournament.id,
          series_row.id,
          'accepted',
          generated_email,
          generated_phone,
          concat(
            'DONNÉES DE TEST · profil de disponibilité ',
            availability_profile,
            ' · batch ',
            substring(target_batch_id::text from 1 for 8)
          ),
          null,
          null,
          null,
          now()
        )
        returning id into target_team_id;

        insert into public.tournament_team_players (
          team_id,
          tournament_id,
          member_id,
          role,
          first_name,
          last_name,
          email,
          phone,
          display_order
        )
        values
          (
            target_team_id,
            target_tournament.id,
            null,
            'front',
            front_first_name,
            front_last_name,
            generated_email,
            generated_phone,
            0
          ),
          (
            target_team_id,
            target_tournament.id,
            null,
            'back',
            back_first_name,
            back_last_name,
            generated_email,
            generated_phone,
            1
          );

        insert into public.tournament_test_data_teams (batch_id, team_id)
        values (target_batch_id, target_team_id);

        if target_tournament.minimum_weekend_availability_slots > 0 then
          insert into public.tournament_team_availability_slots (
            team_id,
            tournament_id,
            play_date,
            starts_at,
            ends_at
          )
          select
            target_team_id,
            target_tournament.id,
            generated.play_date,
            generated.starts_at,
            generated.ends_at
          from public.tournament_generated_slots(target_tournament.id) as generated
          where generated.phase = 'pools'
            and extract(dow from generated.play_date)::integer in (0, 6)
          order by random()
          limit target_tournament.minimum_weekend_availability_slots;
        end if;

        select count(*)::integer
        into selected_pool_count
        from public.tournament_team_availability_slots as availability
        join public.tournament_generated_slots(target_tournament.id) as generated
          on generated.play_date = availability.play_date
         and generated.starts_at = availability.starts_at
         and generated.ends_at = availability.ends_at
        where availability.team_id = target_team_id
          and generated.phase = 'pools';

        additional_pool_count := greatest(target_pool_count - selected_pool_count, 0);

        if additional_pool_count > 0 then
          insert into public.tournament_team_availability_slots (
            team_id,
            tournament_id,
            play_date,
            starts_at,
            ends_at
          )
          select
            target_team_id,
            target_tournament.id,
            generated.play_date,
            generated.starts_at,
            generated.ends_at
          from public.tournament_generated_slots(target_tournament.id) as generated
          where generated.phase = 'pools'
            and not exists (
              select 1
              from public.tournament_team_availability_slots as selected
              where selected.team_id = target_team_id
                and selected.play_date = generated.play_date
                and selected.starts_at = generated.starts_at
                and selected.ends_at = generated.ends_at
            )
          order by random()
          limit additional_pool_count;
        end if;

        if target_finals_count > 0 then
          insert into public.tournament_team_availability_slots (
            team_id,
            tournament_id,
            play_date,
            starts_at,
            ends_at
          )
          select
            target_team_id,
            target_tournament.id,
            generated.play_date,
            generated.starts_at,
            generated.ends_at
          from public.tournament_generated_slots(target_tournament.id) as generated
          where generated.phase = 'finals'
          order by random()
          limit target_finals_count;
        end if;

        total_created_count := total_created_count + 1;
      end loop;
    end if;

    series_summary := series_summary || jsonb_build_array(
      jsonb_build_object(
        'series_id', series_row.id,
        'series_name', series_row.name,
        'capacity', series_row.capacity,
        'existing_active_teams', existing_active_count,
        'created_teams', series_created_count
      )
    );
  end loop;

  if total_created_count = 0 then
    raise exception 'Tournament series have no remaining capacity'
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
    target_tournament.id,
    'test_data_generated',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'batch_id', target_batch_id,
      'created_teams', total_created_count,
      'teams_per_series', target_teams_per_series,
      'available_pool_slots', available_pool_slot_count,
      'available_finals_slots', available_finals_slot_count,
      'series', series_summary
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'batch_id', target_batch_id,
    'created_teams', total_created_count,
    'teams_per_series', target_teams_per_series,
    'available_slots', available_pool_slot_count + available_finals_slot_count,
    'available_pool_slots', available_pool_slot_count,
    'available_finals_slots', available_finals_slot_count,
    'available_weekend_slots', available_pool_weekend_slot_count,
    'series', series_summary
  );
end;
$$;

revoke all on function public.admin_list_tournaments() from public;
revoke all on function public.admin_get_tournament(uuid) from public;
revoke all on function public.admin_create_tournament(jsonb) from public;
revoke all on function public.admin_update_tournament(uuid, jsonb) from public;
revoke all on function public.admin_save_tournament_configuration(uuid, jsonb) from public;
revoke all on function public.get_public_tournament_availability_grid(uuid) from public;
revoke all on function public.get_my_tournament_registration_v2(uuid) from public, anon, authenticated;
revoke all on function public.save_my_tournament_registration_v2(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_get_tournament_dated_availability(uuid) from public, anon, authenticated;
revoke all on function public.admin_get_tournament_team_dated_availability(uuid) from public, anon, authenticated;
revoke all on function public.admin_save_tournament_team_v2(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.generate_tournament_test_data(uuid, integer) from public, anon, authenticated;

grant execute on function public.admin_list_tournaments() to authenticated;
grant execute on function public.admin_get_tournament(uuid) to authenticated;
grant execute on function public.admin_create_tournament(jsonb) to authenticated;
grant execute on function public.admin_update_tournament(uuid, jsonb) to authenticated;
grant execute on function public.admin_save_tournament_configuration(uuid, jsonb) to authenticated;
grant execute on function public.get_public_tournament_availability_grid(uuid) to anon, authenticated;
grant execute on function public.get_my_tournament_registration_v2(uuid) to authenticated;
grant execute on function public.save_my_tournament_registration_v2(uuid, jsonb) to authenticated;
grant execute on function public.admin_get_tournament_dated_availability(uuid) to authenticated;
grant execute on function public.admin_get_tournament_team_dated_availability(uuid) to authenticated;
grant execute on function public.admin_save_tournament_team_v2(uuid, uuid, jsonb) to authenticated;

commit;
