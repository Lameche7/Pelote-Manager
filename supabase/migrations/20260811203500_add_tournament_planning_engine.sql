begin;

-- PR76 — première brique du Planning Engine.
-- Les poules validées produisent une rencontre par paire d'équipes.
-- Le moteur TypeScript propose ensuite un planning ; cette migration ne persiste
-- que des affectations complètes et cohérentes. La publication dans le Calendrier
-- reste volontairement hors périmètre de cette PR.

create table public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  pool_id uuid not null references public.tournament_pools (id) on delete cascade,
  series_id uuid not null references public.tournament_series (id) on delete cascade,
  team_a_id uuid not null references public.tournament_teams (id) on delete restrict,
  team_b_id uuid not null references public.tournament_teams (id) on delete restrict,
  display_order integer not null check (display_order >= 0),
  status text not null default 'to_schedule'
    check (status in ('to_schedule', 'scheduled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (team_a_id <> team_b_id),
  unique (pool_id, team_a_id, team_b_id),
  unique (pool_id, display_order)
);

create table public.tournament_match_planning (
  match_id uuid primary key references public.tournament_matches (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  resource_id uuid not null references public.reservable_resources (id) on delete restrict,
  play_date date not null,
  starts_at time not null,
  ends_at time not null,
  source text not null default 'generated'
    check (source in ('generated', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (tournament_id, resource_id, play_date, starts_at)
);

create index tournament_matches_tournament_pool_idx
on public.tournament_matches (tournament_id, pool_id, display_order);

create index tournament_match_planning_tournament_slot_idx
on public.tournament_match_planning (
  tournament_id,
  play_date,
  starts_at,
  resource_id
);

alter table public.tournament_matches enable row level security;
alter table public.tournament_match_planning enable row level security;

revoke all on table public.tournament_matches from public, anon, authenticated;
revoke all on table public.tournament_match_planning from public, anon, authenticated;

create or replace function public.admin_prepare_tournament_matches(
  target_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  result_count integer;
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

create or replace function public.admin_get_tournament_planning_workspace(
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

  if target_tournament.status not in ('pools_validated', 'planning_generated') then
    raise exception 'Tournament planning is not available at this stage'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', target_tournament.id,
      'name', target_tournament.name,
      'status', target_tournament.status,
      'minimum_rest_minutes', 0
    ),
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
      join public.reservable_resources as resource
        on resource.id = selected.resource_id
      where selected.tournament_id = target_tournament.id
    ),
    'slots', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', concat(
              selected.resource_id,
              '|', generated.play_date,
              '|', generated.starts_at,
              '|', generated.ends_at
            ),
            'resource_id', selected.resource_id,
            'resource_name', resource.name,
            'date', generated.play_date,
            'starts_at', generated.starts_at,
            'ends_at', generated.ends_at
          )
          order by generated.play_date, generated.starts_at, selected.display_order
        ),
        '[]'::jsonb
      )
      from public.tournament_generated_slots(target_tournament.id) as generated
      cross join public.tournament_resources as selected
      join public.reservable_resources as resource
        on resource.id = selected.resource_id
      where selected.tournament_id = target_tournament.id
        and generated.phase = 'pools'
    ),
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', team.id,
            'players', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'first_name', player.first_name,
                    'last_name', player.last_name,
                    'role', player.role
                  )
                  order by player.display_order
                ),
                '[]'::jsonb
              )
              from public.tournament_team_players as player
              where player.team_id = team.id
            )
          )
          order by team.registered_at, team.id
        ),
        '[]'::jsonb
      )
      from public.tournament_teams as team
      where team.tournament_id = target_tournament.id
        and team.status = 'accepted'
    ),
    'availability', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'team_id', team.id,
            'slots', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'date', availability.play_date,
                    'starts_at', availability.starts_at,
                    'ends_at', availability.ends_at
                  )
                  order by availability.play_date, availability.starts_at
                ),
                '[]'::jsonb
              )
              from public.tournament_team_availability_slots as availability
              join public.tournament_generated_slots(target_tournament.id) as generated
                on generated.play_date = availability.play_date
               and generated.starts_at = availability.starts_at
               and generated.ends_at = availability.ends_at
               and generated.phase = 'pools'
              where availability.tournament_id = target_tournament.id
                and availability.team_id = team.id
            )
          )
          order by team.id
        ),
        '[]'::jsonb
      )
      from public.tournament_teams as team
      where team.tournament_id = target_tournament.id
        and team.status = 'accepted'
    ),
    'matches', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', match.id,
            'pool_id', match.pool_id,
            'series_id', match.series_id,
            'team_a_id', match.team_a_id,
            'team_b_id', match.team_b_id,
            'display_order', match.display_order
          )
          order by pool.series_id, pool.display_order, match.display_order
        ),
        '[]'::jsonb
      )
      from public.tournament_matches as match
      join public.tournament_pools as pool on pool.id = match.pool_id
      where match.tournament_id = target_tournament.id
    ),
    'planning', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'match_id', planning.match_id,
            'slot_id', concat(
              planning.resource_id,
              '|', planning.play_date,
              '|', planning.starts_at,
              '|', planning.ends_at
            ),
            'source', planning.source
          )
          order by planning.play_date, planning.starts_at, planning.resource_id
        ),
        '[]'::jsonb
      )
      from public.tournament_match_planning as planning
      where planning.tournament_id = target_tournament.id
    )
  );
end;
$$;

create or replace function public.admin_save_tournament_planning(
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

  if target_tournament.status not in ('pools_validated', 'planning_generated') then
    raise exception 'Tournament planning is not editable at this stage'
      using errcode = 'P0001';
  end if;

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

revoke all on function public.admin_prepare_tournament_matches(uuid)
from public, anon, authenticated;
revoke all on function public.admin_get_tournament_planning_workspace(uuid)
from public, anon, authenticated;
revoke all on function public.admin_save_tournament_planning(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.admin_prepare_tournament_matches(uuid)
to authenticated;
grant execute on function public.admin_get_tournament_planning_workspace(uuid)
to authenticated;
grant execute on function public.admin_save_tournament_planning(uuid, jsonb)
to authenticated;

commit;
