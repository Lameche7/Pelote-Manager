begin;

-- PR70 — Pool Engine.
-- Les poules restent privées et sont manipulées uniquement via des RPC admin.

create table public.tournament_pools (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  series_id uuid not null references public.tournament_series (id) on delete cascade,
  display_order integer not null check (display_order >= 0),
  target_size smallint not null check (target_size in (4, 5)),
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, series_id, display_order)
);

create table public.tournament_pool_teams (
  pool_id uuid not null references public.tournament_pools (id) on delete cascade,
  team_id uuid not null references public.tournament_teams (id) on delete cascade,
  display_order integer not null check (display_order >= 0),
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (pool_id, team_id),
  unique (team_id),
  unique (pool_id, display_order)
);

create index tournament_pools_tournament_series_idx
on public.tournament_pools (tournament_id, series_id, display_order);

create index tournament_pool_teams_pool_idx
on public.tournament_pool_teams (pool_id, display_order);

alter table public.tournament_pools enable row level security;
alter table public.tournament_pool_teams enable row level security;

revoke all on table public.tournament_pools from public, anon, authenticated;
revoke all on table public.tournament_pool_teams from public, anon, authenticated;

create or replace function public.tournament_pools_are_complete(
  target_tournament_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.tournaments as tournament
      where tournament.id = target_tournament_id
    )
    and not exists (
      select 1
      from public.tournament_pools as pool
      left join lateral (
        select count(*)::integer as team_count
        from public.tournament_pool_teams as assignment
        where assignment.pool_id = pool.id
      ) as stats on true
      where pool.tournament_id = target_tournament_id
        and (
          pool.target_size not in (4, 5)
          or stats.team_count <> pool.target_size
        )
    )
    and not exists (
      select 1
      from public.tournament_pool_teams as assignment
      join public.tournament_pools as pool on pool.id = assignment.pool_id
      join public.tournament_teams as team on team.id = assignment.team_id
      where pool.tournament_id = target_tournament_id
        and (
          team.tournament_id <> target_tournament_id
          or team.series_id <> pool.series_id
          or team.status <> 'accepted'
        )
    )
    and not exists (
      select 1
      from public.tournament_teams as team
      where team.tournament_id = target_tournament_id
        and team.status = 'accepted'
        and not exists (
          select 1
          from public.tournament_pool_teams as assignment
          join public.tournament_pools as pool on pool.id = assignment.pool_id
          where assignment.team_id = team.id
            and pool.tournament_id = target_tournament_id
        )
    )
    and not exists (
      select 1
      from public.tournament_pools as pool
      where pool.tournament_id = target_tournament_id
        and not exists (
          select 1
          from public.tournament_series as series
          where series.id = pool.series_id
            and series.tournament_id = target_tournament_id
            and series.enabled
        )
    );
$$;

revoke all on function public.tournament_pools_are_complete(uuid)
from public, anon, authenticated;

create or replace function public.admin_get_tournament_pool_workspace(
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
    'tournament', jsonb_build_object(
      'id', target_tournament.id,
      'name', target_tournament.name,
      'status', target_tournament.status,
      'pending_count', (
        select count(*)
        from public.tournament_teams as team
        where team.tournament_id = target_tournament.id
          and team.status = 'pending'
      )
    ),
    'series', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', series.id,
            'name', series.name,
            'display_order', series.display_order,
            'accepted_count', (
              select count(*)
              from public.tournament_teams as team
              where team.series_id = series.id
                and team.status = 'accepted'
            )
          )
          order by series.display_order, series.name
        ),
        '[]'::jsonb
      )
      from public.tournament_series as series
      where series.tournament_id = target_tournament.id
        and series.enabled
    ),
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', team.id,
            'series_id', team.series_id,
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
            ),
            'pool_availability_count', (
              select count(*)
              from public.tournament_team_availability_slots as availability
              join public.tournament_generated_slots(target_tournament.id) as generated
                on generated.play_date = availability.play_date
               and generated.starts_at = availability.starts_at
               and generated.ends_at = availability.ends_at
               and generated.phase = 'pools'
              where availability.team_id = team.id
                and availability.tournament_id = target_tournament.id
            )
          )
          order by team.series_id, team.registered_at, team.id
        ),
        '[]'::jsonb
      )
      from public.tournament_teams as team
      where team.tournament_id = target_tournament.id
        and team.status = 'accepted'
    ),
    'pairings', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'series_id', team_a.series_id,
            'team_a_id', team_a.id,
            'team_b_id', team_b.id,
            'common_slot_count', coalesce(compatibility.common_slot_count, 0)
          )
          order by team_a.series_id, team_a.id, team_b.id
        ),
        '[]'::jsonb
      )
      from public.tournament_teams as team_a
      join public.tournament_teams as team_b
        on team_b.tournament_id = team_a.tournament_id
       and team_b.series_id = team_a.series_id
       and team_b.status = 'accepted'
       and team_b.id > team_a.id
      left join lateral (
        select count(*)::integer as common_slot_count
        from public.tournament_team_availability_slots as availability_a
        join public.tournament_team_availability_slots as availability_b
          on availability_b.tournament_id = availability_a.tournament_id
         and availability_b.play_date = availability_a.play_date
         and availability_b.starts_at = availability_a.starts_at
         and availability_b.ends_at = availability_a.ends_at
        join public.tournament_generated_slots(target_tournament.id) as generated
          on generated.play_date = availability_a.play_date
         and generated.starts_at = availability_a.starts_at
         and generated.ends_at = availability_a.ends_at
         and generated.phase = 'pools'
        where availability_a.tournament_id = target_tournament.id
          and availability_a.team_id = team_a.id
          and availability_b.team_id = team_b.id
      ) as compatibility on true
      where team_a.tournament_id = target_tournament.id
        and team_a.status = 'accepted'
    ),
    'pools', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', pool.id,
            'series_id', pool.series_id,
            'display_order', pool.display_order,
            'target_size', pool.target_size,
            'is_locked', pool.is_locked,
            'teams', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'team_id', assignment.team_id,
                    'display_order', assignment.display_order,
                    'is_locked', assignment.is_locked
                  )
                  order by assignment.display_order
                ),
                '[]'::jsonb
              )
              from public.tournament_pool_teams as assignment
              where assignment.pool_id = pool.id
            )
          )
          order by pool.series_id, pool.display_order
        ),
        '[]'::jsonb
      )
      from public.tournament_pools as pool
      where pool.tournament_id = target_tournament.id
    )
  );
end;
$$;

create or replace function public.admin_save_tournament_pools(
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
  pool_values jsonb := coalesce(payload->'pools', '[]'::jsonb);
  pool_item jsonb;
  team_item jsonb;
  target_series_id uuid;
  target_team_id uuid;
  target_display_order integer;
  target_size integer;
  target_pool_locked boolean;
  target_team_locked boolean;
  target_pool_id uuid;
  target_team_display_order integer;
  accepted_count integer;
  assigned_count integer := 0;
  seen_team_ids uuid[] := '{}'::uuid[];
  seen_pool_keys text[] := '{}'::text[];
  pool_key text;
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
      or target_size not in (4, 5)
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
    target_pool_locked := coalesce((pool_item->>'is_locked')::boolean, false);

    insert into public.tournament_pools (
      tournament_id,
      series_id,
      display_order,
      target_size,
      is_locked,
      updated_at
    )
    values (
      target_tournament.id,
      target_series_id,
      target_display_order,
      target_size,
      target_pool_locked,
      now()
    )
    returning id into target_pool_id;

    target_team_display_order := 0;
    for team_item in
      select value from jsonb_array_elements(pool_item->'teams')
    loop
      target_team_id := (team_item->>'team_id')::uuid;
      target_team_locked := coalesce((team_item->>'is_locked')::boolean, false);

      insert into public.tournament_pool_teams (
        pool_id,
        team_id,
        display_order,
        is_locked
      )
      values (
        target_pool_id,
        target_team_id,
        coalesce(
          nullif(team_item->>'display_order', '')::integer,
          target_team_display_order
        ),
        target_pool_locked or target_team_locked
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

create or replace function public.admin_validate_tournament_pools(
  target_tournament_id uuid
)
returns void
language plpgsql
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

  update public.tournament_pools
  set is_locked = true, updated_at = now()
  where tournament_id = target_tournament.id;

  update public.tournament_pool_teams as assignment
  set is_locked = true
  from public.tournament_pools as pool
  where pool.id = assignment.pool_id
    and pool.tournament_id = target_tournament.id;

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

revoke all on function public.admin_get_tournament_pool_workspace(uuid)
from public, anon;
revoke all on function public.admin_save_tournament_pools(uuid, jsonb)
from public, anon;
revoke all on function public.admin_validate_tournament_pools(uuid)
from public, anon;

grant execute on function public.admin_get_tournament_pool_workspace(uuid)
to authenticated;
grant execute on function public.admin_save_tournament_pools(uuid, jsonb)
to authenticated;
grant execute on function public.admin_validate_tournament_pools(uuid)
to authenticated;

commit;
