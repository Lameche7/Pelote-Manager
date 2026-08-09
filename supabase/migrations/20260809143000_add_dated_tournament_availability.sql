begin;

-- PR65 refinement — dated availability grid.
-- Availability is now stored as real tournament dates and generated from the
-- weekly play windows configured by the tournament administrator.

alter table public.tournaments
add column if not exists minimum_availability_slots integer not null default 65;

alter table public.tournaments
add column if not exists minimum_weekend_availability_slots integer not null default 0;

alter table public.tournaments
add column if not exists slot_duration_minutes integer not null default 60;

alter table public.tournaments
drop constraint if exists tournaments_minimum_availability_slots_check;
alter table public.tournaments
add constraint tournaments_minimum_availability_slots_check
check (minimum_availability_slots >= 0);

alter table public.tournaments
drop constraint if exists tournaments_minimum_weekend_availability_slots_check;
alter table public.tournaments
add constraint tournaments_minimum_weekend_availability_slots_check
check (
  minimum_weekend_availability_slots >= 0
  and minimum_weekend_availability_slots <= minimum_availability_slots
);

alter table public.tournaments
drop constraint if exists tournaments_slot_duration_minutes_check;
alter table public.tournaments
add constraint tournaments_slot_duration_minutes_check
check (slot_duration_minutes between 15 and 240);

create table if not exists public.tournament_team_availability_slots (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.tournament_teams (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  play_date date not null,
  starts_at time not null,
  ends_at time not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (team_id, play_date, starts_at, ends_at)
);

create index if not exists tournament_team_availability_slots_team_idx
on public.tournament_team_availability_slots (team_id, play_date, starts_at);

create index if not exists tournament_team_availability_slots_tournament_idx
on public.tournament_team_availability_slots (tournament_id, play_date, starts_at);

alter table public.tournament_team_availability_slots enable row level security;
revoke all on table public.tournament_team_availability_slots from public, anon, authenticated;

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
  slot_interval interval;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.status not in ('preparation', 'configuration', 'cancelled');

  if target_tournament.id is null then
    return null;
  end if;

  slot_interval := make_interval(mins => target_tournament.slot_duration_minutes);

  return jsonb_build_object(
    'minimum_total', target_tournament.minimum_availability_slots,
    'minimum_weekend', target_tournament.minimum_weekend_availability_slots,
    'slot_duration_minutes', target_tournament.slot_duration_minutes,
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
            'ends_at', availability.ends_at
          )
          order by availability.play_date, availability.starts_at, availability.ends_at
        ),
        '[]'::jsonb
      )
      from public.tournament_team_availability_slots as availability
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
  slot_interval interval;
  slot_key text;
  seen_keys text[] := '{}'::text[];
  selected_count integer := 0;
  weekend_count integer := 0;
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
        where play_window.tournament_id = target_tournament_id
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
      'slot_count', selected_count,
      'weekend_slot_count', weekend_count
    ),
    target_user_id
  );

  return target_team_id;
end;
$$;

revoke all on function public.get_public_tournament_availability_grid(uuid) from public;
revoke all on function public.get_my_tournament_registration_v2(uuid) from public, anon, authenticated;
revoke all on function public.save_my_tournament_registration_v2(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.get_public_tournament_availability_grid(uuid) to anon, authenticated;
grant execute on function public.get_my_tournament_registration_v2(uuid) to authenticated;
grant execute on function public.save_my_tournament_registration_v2(uuid, jsonb) to authenticated;

commit;
