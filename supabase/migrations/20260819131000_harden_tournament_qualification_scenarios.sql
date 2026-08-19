begin;

-- Une égalité parfaite sur la limite de qualification ne doit jamais être
-- tranchée artificiellement par le nom ou l'UUID. Pour les scénarios joueurs,
-- on retient donc la pire position possible au sein d'un groupe strictement
-- ex aequo : un message « qualifié » reste ainsi toujours mathématiquement sûr.
create or replace function public.tournament_simulated_general_seed(
  target_tournament_id uuid,
  target_series_id uuid,
  target_match_id uuid,
  score_payload jsonb,
  target_team_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_match public.tournament_matches;
  rules public.tournament_sporting_rules;
  calculated jsonb;
  simulated_seed integer;
begin
  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = target_match_id
    and match.tournament_id = target_tournament_id;

  if target_match.id is null then
    return null;
  end if;

  select sporting_rules.*
  into rules
  from public.tournament_sporting_rules as sporting_rules
  where sporting_rules.tournament_id = target_tournament_id;

  if rules.tournament_id is null then
    return null;
  end if;

  calculated := public.tournament_calculate_match_result(
    target_match_id,
    score_payload
  );

  with adjusted as (
    select
      ranking.team_id,
      ranking.team_label,
      ranking.matches_played + case
        when ranking.team_id in (target_match.team_a_id, target_match.team_b_id)
          then 1 else 0
      end as matches_played,
      ranking.wins + case
        when ranking.team_id = (calculated->>'winner_team_id')::uuid then 1
        else 0
      end as wins,
      ranking.ranking_points + case
        when ranking.team_id = target_match.team_a_id
          then (calculated->>'team_a_ranking_points')::integer
        when ranking.team_id = target_match.team_b_id
          then (calculated->>'team_b_ranking_points')::integer
        else 0
      end as ranking_points,
      ranking.points_for + case
        when ranking.team_id = target_match.team_a_id
          then (calculated->>'team_a_points')::integer
        when ranking.team_id = target_match.team_b_id
          then (calculated->>'team_b_points')::integer
        else 0
      end as points_for,
      ranking.points_against + case
        when ranking.team_id = target_match.team_a_id
          then (calculated->>'team_b_points')::integer
        when ranking.team_id = target_match.team_b_id
          then (calculated->>'team_a_points')::integer
        else 0
      end as points_against
    from public.tournament_general_ranking_rows(
      target_tournament_id,
      target_series_id
    ) as ranking
  ), metrics as (
    select
      adjusted.*,
      case
        when rules.ranking_mode = 'points_per_match'
          and adjusted.matches_played > 0
          then adjusted.ranking_points::numeric / adjusted.matches_played
        when rules.ranking_mode = 'points_per_match' then 0::numeric
        else adjusted.ranking_points::numeric
      end as ranking_value,
      case
        when rules.goal_average_mode = 'point_difference_per_match'
          and adjusted.matches_played > 0
          then (adjusted.points_for - adjusted.points_against)::numeric
            / adjusted.matches_played
        when rules.goal_average_mode = 'point_difference_per_match' then 0::numeric
        else (adjusted.points_for - adjusted.points_against)::numeric
      end as goal_average_value,
      case
        when adjusted.matches_played > 0
          then adjusted.points_for::numeric / adjusted.matches_played
        else 0::numeric
      end as points_for_per_match,
      case
        when adjusted.matches_played > 0
          then adjusted.wins::numeric / adjusted.matches_played
        else 0::numeric
      end as win_percentage
    from adjusted
    cross join rules
  ), seeded as (
    select
      metrics.*,
      row_number() over (
        order by
          metrics.ranking_value desc,
          metrics.goal_average_value desc,
          metrics.points_for_per_match desc,
          metrics.win_percentage desc,
          metrics.team_label,
          metrics.team_id
      )::integer as seed
    from metrics
  ), tie_safe as (
    select
      seeded.team_id,
      max(seeded.seed) over (
        partition by
          seeded.ranking_value,
          seeded.goal_average_value,
          seeded.points_for_per_match,
          seeded.win_percentage
      )::integer as guaranteed_seed
    from seeded
  )
  select tie_safe.guaranteed_seed
  into simulated_seed
  from tie_safe
  where tie_safe.team_id = target_team_id;

  return simulated_seed;
end;
$$;

revoke all on function public.tournament_simulated_general_seed(uuid, uuid, uuid, jsonb, uuid)
from public, anon, authenticated;

create or replace function public.tournament_main_bracket_size(
  qualifier_count integer
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  result integer := 1;
begin
  if qualifier_count < 2 then
    return 0;
  end if;

  while result * 2 <= qualifier_count loop
    result := result * 2;
  end loop;

  return result;
end;
$$;

revoke all on function public.tournament_main_bracket_size(integer)
from public, anon, authenticated;

create or replace function public.get_tournament_final_stage_shape(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'series_id', series.id,
        'series_name', series.name,
        'qualifier_count', series.finals_qualifier_count,
        'main_bracket_size',
          public.tournament_main_bracket_size(series.finals_qualifier_count),
        'direct_qualifiers', case
          when series.finals_qualifier_count < 2 then 0
          when series.finals_qualifier_count = public.tournament_main_bracket_size(
            series.finals_qualifier_count
          ) then series.finals_qualifier_count
          else 2 * public.tournament_main_bracket_size(
            series.finals_qualifier_count
          ) - series.finals_qualifier_count
        end,
        'preliminary_matches', case
          when series.finals_qualifier_count < 2 then 0
          else series.finals_qualifier_count
            - public.tournament_main_bracket_size(
                series.finals_qualifier_count
              )
        end
      )
      order by series.display_order, series.name
    )
    from public.tournament_series as series
    where series.tournament_id = target_tournament_id
      and series.enabled
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_tournament_final_stage_shape(uuid)
from public;
grant execute on function public.get_tournament_final_stage_shape(uuid)
to anon, authenticated;

commit;
