-- Draft: explicitly club-scoped tournament planning workspace.
create or replace function public.admin_get_tournament_planning_workspace_for_club(
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
       and resource.club_id = target_club_id
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
       and resource.club_id = target_club_id
      where selected.tournament_id = target_tournament.id
        and generated.phase = 'pools'
        and not exists (
          select 1
          from public.tournament_match_planning as occupied
          join public.tournaments as other_tournament on other_tournament.id = occupied.tournament_id
          where other_tournament.club_id = target_club_id
            and other_tournament.id <> target_tournament.id
            and other_tournament.status not in ('cancelled', 'archived')
            and occupied.resource_id = selected.resource_id
            and occupied.play_date = generated.play_date
            and occupied.starts_at < generated.ends_at
            and occupied.ends_at > generated.starts_at
        )
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
                and player.tournament_id = target_tournament.id
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
                and not exists (
                  select 1
                  from public.tournament_match_planning as occupied
                  join public.tournaments as other_tournament on other_tournament.id = occupied.tournament_id
                  join public.tournament_matches as other_match on other_match.id = occupied.match_id
                    and other_match.tournament_id = other_tournament.id
                  join public.tournament_team_players as other_player
                    on other_player.tournament_id = other_tournament.id
                   and other_player.team_id in (other_match.team_a_id, other_match.team_b_id)
                  join public.tournament_team_players as current_player
                    on current_player.tournament_id = target_tournament.id
                   and current_player.team_id = team.id
                  left join public.tournament_external_player_identities as current_identity
                    on current_identity.id = current_player.external_identity_id
                   and current_identity.status = 'verified'
                  left join public.tournament_external_player_identities as other_identity
                    on other_identity.id = other_player.external_identity_id
                   and other_identity.status = 'verified'
                  where other_tournament.club_id = target_club_id
                    and other_tournament.id <> target_tournament.id
                    and other_tournament.status not in ('cancelled', 'archived')
                    and occupied.play_date = availability.play_date
                    and occupied.starts_at < availability.ends_at
                    and occupied.ends_at > availability.starts_at
                    and (
                      current_player.member_id = other_player.member_id
                      or current_player.external_identity_id = other_player.external_identity_id
                      or current_identity.profile_id = other_identity.profile_id
                    )
                )
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
        and pool.tournament_id = target_tournament.id
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
      join public.reservable_resources as resource on resource.id = planning.resource_id
        and resource.club_id = target_club_id
      join public.tournament_matches as match on match.id = planning.match_id
        and match.tournament_id = target_tournament.id
      where planning.tournament_id = target_tournament.id
    )
  );
end;
$$;
revoke all on function public.admin_get_tournament_planning_workspace_for_club(uuid,uuid) from public, anon, authenticated;
