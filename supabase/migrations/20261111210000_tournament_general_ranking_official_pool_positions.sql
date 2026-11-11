-- Use the official per-pool position as the first general ranking criterion.
-- General tournament standings group all pool winners before runners-up, etc.
-- Preserve existing return signature consumed by final-stage qualification.
create or replace function public.tournament_general_ranking_rows(
  target_tournament_id uuid,
  target_series_id uuid
)
returns table (
  "position" integer,
  team_id uuid,
  team_label text,
  pool_number integer,
  matches_played integer,
  total_matches integer,
  wins integer,
  losses integer,
  ranking_points integer,
  ranking_value numeric,
  points_for integer,
  points_against integer,
  point_difference integer,
  goal_average_value numeric,
  points_for_per_match numeric,
  win_percentage numeric,
  tie_count integer,
  tie_first_position integer,
  tie_last_position integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with rules as (
    select sporting_rules.*
    from public.tournament_sporting_rules as sporting_rules
    where sporting_rules.tournament_id = target_tournament_id
  ), team_stats as (
    select
      assignment.team_id,
      min(pool.display_order + 1)::integer as pool_number,
      coalesce((
        select string_agg(
          btrim(concat_ws(' ', player.first_name, player.last_name)),
          ' / '
          order by player.display_order
        )
        from public.tournament_team_players as player
        where player.team_id = assignment.team_id
      ), 'Équipe') as team_label,
      count(distinct match.id)::integer as total_matches,
      count(distinct result.id)::integer as matches_played,
      count(distinct result.id) filter (
        where result.winner_team_id = assignment.team_id
      )::integer as wins,
      count(distinct result.id) filter (
        where result.winner_team_id <> assignment.team_id
      )::integer as losses,
      coalesce(sum(
        case
          when result.id is null then 0
          when match.team_a_id = assignment.team_id then result.team_a_ranking_points
          when match.team_b_id = assignment.team_id then result.team_b_ranking_points
          else 0
        end
      ), 0)::integer as ranking_points,
      coalesce(sum(
        case
          when result.id is null then 0
          when match.team_a_id = assignment.team_id then result.team_a_points
          when match.team_b_id = assignment.team_id then result.team_b_points
          else 0
        end
      ), 0)::integer as points_for,
      coalesce(sum(
        case
          when result.id is null then 0
          when match.team_a_id = assignment.team_id then result.team_b_points
          when match.team_b_id = assignment.team_id then result.team_a_points
          else 0
        end
      ), 0)::integer as points_against
    from public.tournament_pool_teams as assignment
    join public.tournament_pools as pool
      on pool.id = assignment.pool_id
     and pool.tournament_id = target_tournament_id
     and pool.series_id = target_series_id
    left join public.tournament_matches as match
      on match.pool_id = assignment.pool_id
     and assignment.team_id in (match.team_a_id, match.team_b_id)
    left join public.tournament_match_results as result
      on result.match_id = match.id
     and result.status = 'validated'
    group by assignment.team_id
  ), calculated as (
    select
      team_stats.*,
      team_stats.points_for - team_stats.points_against as point_difference,
      case
        when rules.ranking_mode = 'points_per_match'
          and team_stats.matches_played > 0
          then team_stats.ranking_points::numeric / team_stats.matches_played
        when rules.ranking_mode = 'points_per_match'
          then 0::numeric
        else team_stats.ranking_points::numeric
      end as ranking_value,
      case
        when rules.goal_average_mode = 'point_difference_per_match'
          and team_stats.matches_played > 0
          then (team_stats.points_for - team_stats.points_against)::numeric
            / team_stats.matches_played
        when rules.goal_average_mode = 'point_difference_per_match'
          then 0::numeric
        else (team_stats.points_for - team_stats.points_against)::numeric
      end as goal_average_value,
      case
        when team_stats.matches_played > 0
          then team_stats.points_for::numeric / team_stats.matches_played
        else 0::numeric
      end as points_for_per_match,
      case
        when team_stats.matches_played > 0
          then team_stats.wins::numeric / team_stats.matches_played
        else 0::numeric
      end as win_percentage
    from team_stats
    cross join rules
  ), official_pool_positions as (
    -- Reuse the exact positions displayed in each pool, including
    -- head-to-head tie breakers. Do not independently rank pool teams.
    select
      (team.value->>'team_id')::uuid as team_id,
      (team.value->>'position')::integer as pool_rank
    from jsonb_array_elements(
      coalesce(public.get_tournament_rankings(target_tournament_id)->'series', '[]'::jsonb)
    ) as series(value)
    cross join lateral jsonb_array_elements(
      coalesce(series.value->'pools', '[]'::jsonb)
    ) as pool(value)
    cross join lateral jsonb_array_elements(
      coalesce(pool.value->'teams', '[]'::jsonb)
    ) as team(value)
    where (series.value->>'id')::uuid = target_series_id
  ), pool_ranked as (
    select calculated.*, official.pool_rank
    from calculated
    join official_pool_positions as official
      on official.team_id = calculated.team_id
  ), seeded as (
    select
      calculated.*,
      row_number() over (
        order by
          calculated.pool_rank asc,
          calculated.ranking_value desc,
          calculated.goal_average_value desc,
          calculated.points_for_per_match desc,
          calculated.win_percentage desc,
          calculated.team_label,
          calculated.team_id
      )::integer as seed,
      count(*) over (
        partition by
          calculated.pool_rank,
          calculated.ranking_value,
          calculated.goal_average_value,
          calculated.points_for_per_match,
          calculated.win_percentage
      )::integer as tie_count,
      min(row_number_placeholder) over () as unused
    from (
      select calculated.*, 1 as row_number_placeholder
      from pool_ranked as calculated
    ) as calculated
  ), tie_bounds as (
    select
      seeded.*,
      min(seeded.seed) over (
        partition by
          seeded.pool_rank,
          seeded.ranking_value,
          seeded.goal_average_value,
          seeded.points_for_per_match,
          seeded.win_percentage
      )::integer as tie_first_position,
      max(seeded.seed) over (
        partition by
          seeded.pool_rank,
          seeded.ranking_value,
          seeded.goal_average_value,
          seeded.points_for_per_match,
          seeded.win_percentage
      )::integer as tie_last_position
    from seeded
  )
  select
    tie_bounds.seed,
    tie_bounds.team_id,
    tie_bounds.team_label,
    tie_bounds.pool_number,
    tie_bounds.matches_played,
    tie_bounds.total_matches,
    tie_bounds.wins,
    tie_bounds.losses,
    tie_bounds.ranking_points,
    round(tie_bounds.ranking_value, 3),
    tie_bounds.points_for,
    tie_bounds.points_against,
    tie_bounds.point_difference,
    round(tie_bounds.goal_average_value, 3),
    round(tie_bounds.points_for_per_match, 3),
    round(tie_bounds.win_percentage * 100, 1),
    tie_bounds.tie_count,
    tie_bounds.tie_first_position,
    tie_bounds.tie_last_position
  from tie_bounds
  order by tie_bounds.seed;
$$;

