begin;

-- PR76 refinement — visual tournament planning.
-- Keep the Planning Engine independent from the reservation calendar while
-- enriching its workspace with tournament dates and persistent series colors.

alter table public.tournament_series
add column if not exists color text;

update public.tournament_series
set color = case mod(display_order, 10)
  when 0 then '#2563EB'
  when 1 then '#DC2626'
  when 2 then '#16A34A'
  when 3 then '#9333EA'
  when 4 then '#EA580C'
  when 5 then '#0891B2'
  when 6 then '#DB2777'
  when 7 then '#4F46E5'
  when 8 then '#65A30D'
  else '#B45309'
end
where color is null
   or color !~ '^#[0-9A-Fa-f]{6}$';

alter table public.tournament_series
alter column color set default '#2563EB';

alter table public.tournament_series
alter column color set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tournament_series_color_check'
      and conrelid = 'public.tournament_series'::regclass
  ) then
    alter table public.tournament_series
    add constraint tournament_series_color_check
    check (color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end
$$;

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
      'starts_on', target_tournament.starts_on,
      'ends_on', target_tournament.ends_on,
      'pool_starts_on', target_tournament.pool_starts_on,
      'pool_ends_on', target_tournament.pool_ends_on,
      'finals_starts_on', target_tournament.finals_starts_on,
      'finals_ends_on', target_tournament.finals_ends_on,
      'slot_duration_minutes', target_tournament.slot_duration_minutes,
      'minimum_rest_minutes', 0
    ),
    'series', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', series.id,
            'name', series.name,
            'color', series.color,
            'display_order', series.display_order
          )
          order by series.display_order, series.name
        ),
        '[]'::jsonb
      )
      from public.tournament_series as series
      where series.tournament_id = target_tournament.id
        and series.enabled
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

revoke all on function public.admin_update_tournament_series_colors(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_get_tournament_planning_workspace(uuid)
from public, anon, authenticated;

grant execute on function public.admin_update_tournament_series_colors(uuid, jsonb)
to authenticated;
grant execute on function public.admin_get_tournament_planning_workspace(uuid)
to authenticated;

commit;
