begin;

-- PR68 — édition administrative des disponibilités datées.

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
  slot_interval interval;
  available_slot_count integer := 0;
  available_weekend_slot_count integer := 0;
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

  slot_interval := make_interval(mins => target_tournament.slot_duration_minutes);

  with generated_slots as (
    select distinct
      date_series.play_timestamp::date as play_date,
      slot_series.starts_at::time as starts_at,
      (slot_series.starts_at + slot_interval)::time as ends_at
    from generate_series(
      target_tournament.starts_on::timestamp,
      target_tournament.ends_on::timestamp,
      interval '1 day'
    ) as date_series(play_timestamp)
    join public.tournament_play_windows as play_window
      on play_window.tournament_id = target_tournament.id
     and play_window.weekday = extract(dow from date_series.play_timestamp)::integer
    cross join lateral generate_series(
      date_series.play_timestamp::date + play_window.opens_at,
      date_series.play_timestamp::date + play_window.closes_at - slot_interval,
      slot_interval
    ) as slot_series(starts_at)
  )
  select
    count(*)::integer,
    count(*) filter (
      where extract(dow from generated_slots.play_date)::integer in (0, 6)
    )::integer
  into available_slot_count, available_weekend_slot_count
  from generated_slots;

  return jsonb_build_object(
    'minimum_total', target_tournament.minimum_availability_slots,
    'minimum_weekend', target_tournament.minimum_weekend_availability_slots,
    'slot_duration_minutes', target_tournament.slot_duration_minutes,
    'available_slot_count', available_slot_count,
    'available_weekend_slot_count', available_weekend_slot_count,
    'slots', (
      with generated_slots as (
        select distinct
          date_series.play_timestamp::date as play_date,
          slot_series.starts_at::time as starts_at,
          (slot_series.starts_at + slot_interval)::time as ends_at
        from generate_series(
          target_tournament.starts_on::timestamp,
          target_tournament.ends_on::timestamp,
          interval '1 day'
        ) as date_series(play_timestamp)
        join public.tournament_play_windows as play_window
          on play_window.tournament_id = target_tournament.id
         and play_window.weekday = extract(dow from date_series.play_timestamp)::integer
        cross join lateral generate_series(
          date_series.play_timestamp::date + play_window.opens_at,
          date_series.play_timestamp::date + play_window.closes_at - slot_interval,
          slot_interval
        ) as slot_series(starts_at)
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'play_date', generated.play_date,
            'starts_at', generated.starts_at,
            'ends_at', generated.ends_at
          )
          order by generated.play_date, generated.starts_at, generated.ends_at
        ),
        '[]'::jsonb
      )
      from generated_slots as generated
    ),
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'team_id', stats.team_id,
            'slot_count', stats.slot_count,
            'weekend_slot_count', stats.weekend_slot_count
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
            where extract(dow from availability.play_date)::integer in (0, 6)
          )::integer as weekend_slot_count
        from public.tournament_teams as team
        left join public.tournament_team_availability_slots as availability
          on availability.team_id = team.id
         and availability.tournament_id = target_tournament.id
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
  target_tournament public.tournaments;
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

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_team.tournament_id;

  return jsonb_build_object(
    'team_id', target_team.id,
    'tournament_id', target_tournament.id,
    'slots', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'play_date', availability.play_date,
            'starts_at', availability.starts_at,
            'ends_at', availability.ends_at
          )
          order by availability.play_date, availability.starts_at, availability.ends_at
        ),
        '[]'::jsonb
      )
      from public.tournament_team_availability_slots as availability
      where availability.team_id = target_team.id
        and availability.tournament_id = target_tournament.id
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
  slot_interval interval;
  slot_key text;
  seen_keys text[] := '{}'::text[];
  selected_count integer := 0;
  weekend_count integer := 0;
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

  slot_interval := make_interval(mins => target_tournament.slot_duration_minutes);

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

    if availability_date < target_tournament.starts_on
      or availability_date > target_tournament.ends_on
      or not exists (
        select 1
        from public.tournament_play_windows as play_window
        cross join lateral generate_series(
          availability_date + play_window.opens_at,
          availability_date + play_window.closes_at - slot_interval,
          slot_interval
        ) as slot_series(starts_at)
        where play_window.tournament_id = target_tournament.id
          and play_window.weekday = extract(dow from availability_date)::integer
          and slot_series.starts_at::time = availability_starts_at
          and (slot_series.starts_at + slot_interval)::time = availability_ends_at
      ) then
      raise exception 'Tournament availability slots are invalid'
        using errcode = '22023';
    end if;

    selected_count := selected_count + 1;
    if extract(dow from availability_date)::integer in (0, 6) then
      weekend_count := weekend_count + 1;
    end if;
  end loop;

  if selected_count < target_tournament.minimum_availability_slots then
    raise exception 'Tournament availability minimum not reached'
      using errcode = '22023';
  end if;

  if weekend_count < target_tournament.minimum_weekend_availability_slots then
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
      'slot_count', selected_count,
      'weekend_slot_count', weekend_count
    ),
    auth.uid()
  );

  return saved_team_id;
end;
$$;

revoke all on function public.admin_get_tournament_dated_availability(uuid)
from public, anon, authenticated;
revoke all on function public.admin_get_tournament_team_dated_availability(uuid)
from public, anon, authenticated;
revoke all on function public.admin_save_tournament_team_v2(uuid, uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.admin_get_tournament_dated_availability(uuid)
to authenticated;
grant execute on function public.admin_get_tournament_team_dated_availability(uuid)
to authenticated;
grant execute on function public.admin_save_tournament_team_v2(uuid, uuid, jsonb)
to authenticated;

commit;
