begin;

-- Ranking Engine — classement calculé à la volée depuis les seuls résultats
-- validés. Aucune ligne de classement n'est persistée : la projection reste
-- toujours cohérente avec les résultats officiels et les règles sportives.
create or replace function public.get_tournament_rankings(
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
  rules public.tournament_sporting_rules;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    return null;
  end if;

  -- Les poules ne deviennent publiques qu'après leur validation.
  if target_tournament.status not in (
    'pools_validated',
    'planning_generated',
    'planning_published',
    'in_progress',
    'completed',
    'archived'
  ) then
    return null;
  end if;

  select sporting_rules.*
  into rules
  from public.tournament_sporting_rules as sporting_rules
  where sporting_rules.tournament_id = target_tournament.id;

  if rules.tournament_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'tournament_id', target_tournament.id,
    'tournament_name', target_tournament.name,
    'status', target_tournament.status,
    'ranking_mode', rules.ranking_mode,
    'goal_average_mode', rules.goal_average_mode,
    'series', coalesce((
      select jsonb_agg(series_payload order by series_display_order, series_name)
      from (
        select
          series.display_order as series_display_order,
          series.name as series_name,
          jsonb_build_object(
            'id', series.id,
            'name', series.name,
            'pools', coalesce((
              select jsonb_agg(pool_payload order by pool_display_order)
              from (
                select
                  pool.display_order as pool_display_order,
                  jsonb_build_object(
                    'id', pool.id,
                    'number', pool.display_order + 1,
                    'total_matches', (
                      select count(*)::integer
                      from public.tournament_matches as match
                      where match.pool_id = pool.id
                    ),
                    'validated_matches', (
                      select count(*)::integer
                      from public.tournament_matches as match
                      join public.tournament_match_results as result
                        on result.match_id = match.id
                       and result.status = 'validated'
                      where match.pool_id = pool.id
                    ),
                    'teams', (
                      with team_stats as (
                        select
                          assignment.team_id,
                          assignment.display_order,
                          coalesce((
                            select string_agg(
                              btrim(concat_ws(' ', player.first_name, player.last_name)),
                              ' / '
                              order by player.display_order
                            )
                            from public.tournament_team_players as player
                            where player.team_id = assignment.team_id
                          ), 'Équipe') as team_label,
                          count(result.id)::integer as matches_played,
                          count(result.id) filter (
                            where result.winner_team_id = assignment.team_id
                          )::integer as wins,
                          count(result.id) filter (
                            where result.winner_team_id <> assignment.team_id
                          )::integer as losses,
                          coalesce(sum(
                            case
                              when match.team_a_id = assignment.team_id
                                then result.team_a_ranking_points
                              when match.team_b_id = assignment.team_id
                                then result.team_b_ranking_points
                              else 0
                            end
                          ), 0)::integer as ranking_points,
                          coalesce(sum(
                            case
                              when match.team_a_id = assignment.team_id
                                then result.team_a_points
                              when match.team_b_id = assignment.team_id
                                then result.team_b_points
                              else 0
                            end
                          ), 0)::integer as points_for,
                          coalesce(sum(
                            case
                              when match.team_a_id = assignment.team_id
                                then result.team_b_points
                              when match.team_b_id = assignment.team_id
                                then result.team_a_points
                              else 0
                            end
                          ), 0)::integer as points_against
                        from public.tournament_pool_teams as assignment
                        left join public.tournament_matches as match
                          on match.pool_id = assignment.pool_id
                         and assignment.team_id in (match.team_a_id, match.team_b_id)
                        left join public.tournament_match_results as result
                          on result.match_id = match.id
                         and result.status = 'validated'
                        where assignment.pool_id = pool.id
                        group by assignment.team_id, assignment.display_order
                      ), calculated as (
                        select
                          team_stats.*,
                          team_stats.points_for - team_stats.points_against
                            as point_difference,
                          case
                            when rules.ranking_mode = 'points_per_match'
                              and team_stats.matches_played > 0
                              then team_stats.ranking_points::numeric
                                / team_stats.matches_played
                            when rules.ranking_mode = 'points_per_match'
                              then 0::numeric
                            else team_stats.ranking_points::numeric
                          end as ranking_value,
                          case
                            when rules.goal_average_mode = 'point_difference_per_match'
                              and team_stats.matches_played > 0
                              then (
                                team_stats.points_for - team_stats.points_against
                              )::numeric / team_stats.matches_played
                            when rules.goal_average_mode = 'point_difference_per_match'
                              then 0::numeric
                            else (
                              team_stats.points_for - team_stats.points_against
                            )::numeric
                          end as goal_average_value
                        from team_stats
                      ), ranked as (
                        select
                          calculated.*,
                          dense_rank() over (
                            order by
                              calculated.ranking_value desc,
                              calculated.goal_average_value desc
                          )::integer as position,
                          count(*) over (
                            partition by
                              calculated.ranking_value,
                              calculated.goal_average_value
                          )::integer as tie_count
                        from calculated
                      )
                      select coalesce(
                        jsonb_agg(
                          jsonb_build_object(
                            'position', ranked.position,
                            'team_id', ranked.team_id,
                            'team_label', ranked.team_label,
                            'matches_played', ranked.matches_played,
                            'wins', ranked.wins,
                            'losses', ranked.losses,
                            'ranking_points', ranked.ranking_points,
                            'ranking_value', round(ranked.ranking_value, 3),
                            'points_for', ranked.points_for,
                            'points_against', ranked.points_against,
                            'point_difference', ranked.point_difference,
                            'goal_average_value', round(ranked.goal_average_value, 3),
                            'is_tied', ranked.tie_count > 1
                          )
                          order by
                            ranked.ranking_value desc,
                            ranked.goal_average_value desc,
                            ranked.points_for desc,
                            ranked.wins desc,
                            ranked.display_order,
                            ranked.team_id
                        ),
                        '[]'::jsonb
                      )
                      from ranked
                    )
                  ) as pool_payload
                from public.tournament_pools as pool
                where pool.series_id = series.id
                  and pool.tournament_id = target_tournament.id
              ) as pool_rows
            ), '[]'::jsonb)
          ) as series_payload
        from public.tournament_series as series
        where series.tournament_id = target_tournament.id
          and series.enabled
      ) as series_rows
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_tournament_rankings(uuid)
from public;
grant execute on function public.get_tournament_rankings(uuid)
to anon, authenticated;

commit;
