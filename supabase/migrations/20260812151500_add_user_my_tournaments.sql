begin;

-- PR79 — projection personnelle des tournois.
-- Un utilisateur retrouve les équipes auxquelles il appartient, qu'il ait créé
-- l'inscription ou qu'il soit le partenaire relié à une fiche licencié.
-- Le planning reste invisible tant qu'il n'a pas été publié par l'administration.

create or replace function public.get_my_tournaments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  current_member_id uuid;
  result jsonb;
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select profile.member_id
  into current_member_id
  from public.profiles as profile
  where profile.id = current_profile_id;

  if not found then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  with my_teams as (
    select distinct on (team.tournament_id)
      team.id,
      team.tournament_id,
      team.series_id,
      team.status,
      team.submitted_by,
      team.registered_at
    from public.tournament_teams as team
    where team.status in ('pending', 'accepted')
      and (
        team.submitted_by = current_profile_id
        or (
          current_member_id is not null
          and exists (
            select 1
            from public.tournament_team_players as player
            where player.team_id = team.id
              and player.member_id = current_member_id
          )
        )
      )
    order by
      team.tournament_id,
      case when team.status = 'accepted' then 0 else 1 end,
      team.registered_at desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', tournament.id,
        'name', tournament.name,
        'status', tournament.status,
        'starts_on', tournament.starts_on,
        'ends_on', tournament.ends_on,
        'registration_closes_at', tournament.registration_closes_at,
        'team', jsonb_build_object(
          'id', team.id,
          'status', team.status,
          'series_id', series.id,
          'series_name', series.name,
          'series_color', series.color,
          'pool_number', pool_assignment.pool_number,
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
          )
        ),
        'planning_published', tournament.status in (
          'planning_published',
          'in_progress',
          'completed',
          'archived'
        ),
        'matches', case
          when tournament.status in (
            'planning_published',
            'in_progress',
            'completed',
            'archived'
          ) then (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', tournament_match.id,
                  'play_date', planning.play_date,
                  'starts_at', planning.starts_at,
                  'ends_at', planning.ends_at,
                  'resource_name', resource.name,
                  'pool_number', match_pool.display_order + 1,
                  'opponent_team_id', opponent.id,
                  'opponent_players', (
                    select coalesce(
                      jsonb_agg(
                        jsonb_build_object(
                          'first_name', opponent_player.first_name,
                          'last_name', opponent_player.last_name,
                          'club_name', opponent_player.club_name,
                          'role', opponent_player.role
                        )
                        order by opponent_player.display_order
                      ),
                      '[]'::jsonb
                    )
                    from public.tournament_team_players as opponent_player
                    where opponent_player.team_id = opponent.id
                  )
                )
                order by planning.play_date, planning.starts_at, resource.name
              ),
              '[]'::jsonb
            )
            from public.tournament_matches as tournament_match
            join public.tournament_match_planning as planning
              on planning.match_id = tournament_match.id
            join public.reservable_resources as resource
              on resource.id = planning.resource_id
            join public.tournament_pools as match_pool
              on match_pool.id = tournament_match.pool_id
            join public.tournament_teams as opponent
              on opponent.id = case
                when tournament_match.team_a_id = team.id
                  then tournament_match.team_b_id
                else tournament_match.team_a_id
              end
            where tournament_match.tournament_id = tournament.id
              and team.id in (
                tournament_match.team_a_id,
                tournament_match.team_b_id
              )
          )
          else '[]'::jsonb
        end
      )
      order by
        case
          when tournament.status in ('completed', 'archived', 'cancelled') then 1
          else 0
        end,
        tournament.starts_on,
        tournament.name
    ),
    '[]'::jsonb
  )
  into result
  from my_teams as team
  join public.tournaments as tournament on tournament.id = team.tournament_id
  join public.tournament_series as series on series.id = team.series_id
  left join lateral (
    select pool.display_order + 1 as pool_number
    from public.tournament_pool_teams as assignment
    join public.tournament_pools as pool on pool.id = assignment.pool_id
    where assignment.team_id = team.id
    limit 1
  ) as pool_assignment on true;

  return result;
end;
$$;

revoke all on function public.get_my_tournaments() from public, anon, authenticated;
grant execute on function public.get_my_tournaments() to authenticated;

commit;
