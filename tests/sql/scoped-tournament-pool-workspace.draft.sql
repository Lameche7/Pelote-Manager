-- Draft: explicit club scope for the pool workspace, including player club labels.
create or replace function public.admin_get_tournament_pool_workspace_v2_for_club(
  target_club_id uuid,
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
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
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
                and team.tournament_id = target_tournament.id
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
                    'club_name', player.club_name,
                    'role', player.role
                  )
                  order by player.display_order
                ),
                '[]'::jsonb
              )
              from public.tournament_team_players as player
              where player.team_id = team.id
                and player.tournament_id = target_tournament.id
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
            'teams', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'team_id', assignment.team_id,
                    'display_order', assignment.display_order
                  )
                  order by assignment.display_order
                ),
                '[]'::jsonb
              )
              from public.tournament_pool_teams as assignment
              join public.tournament_teams as assigned_team on assigned_team.id = assignment.team_id
                and assigned_team.tournament_id = target_tournament.id
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
revoke all on function public.admin_get_tournament_pool_workspace_v2_for_club(uuid,uuid) from public, anon, authenticated;
