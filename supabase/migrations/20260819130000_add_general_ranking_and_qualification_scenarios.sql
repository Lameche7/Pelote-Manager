begin;

-- Qualification finale par série. 0 signifie que la règle n'est pas encore
-- configurée. Une phase finale réelle nécessite au moins deux qualifiés.
alter table public.tournament_series
  add column if not exists finals_qualifier_count integer not null default 0;

alter table public.tournament_series
  drop constraint if exists tournament_series_finals_qualifier_count_check;

alter table public.tournament_series
  add constraint tournament_series_finals_qualifier_count_check
  check (
    finals_qualifier_count >= 0
    and finals_qualifier_count <= capacity
    and finals_qualifier_count <> 1
  );

-- L'administration de ce paramètre reste séparée de la grosse configuration
-- existante afin de ne pas réécrire le moteur déjà validé.
create or replace function public.admin_get_tournament_series_qualifiers(
  target_id uuid
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
  where tournament.id = target_id
    and tournament.club_id = target_club_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'series_id', series.id,
        'finals_qualifier_count', series.finals_qualifier_count
      )
      order by series.display_order, series.name
    )
    from public.tournament_series as series
    where series.tournament_id = target_tournament.id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_get_tournament_series_qualifiers(uuid)
from public, anon, authenticated;
grant execute on function public.admin_get_tournament_series_qualifiers(uuid)
to authenticated;

create or replace function public.admin_save_tournament_series_qualifiers(
  target_id uuid,
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
  target_series public.tournament_series;
  qualifier_count integer;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status in ('completed', 'archived', 'cancelled') then
    raise exception 'Tournament qualification settings are locked at this stage'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(payload, '[]'::jsonb)) <> 'array' then
    raise exception 'Tournament qualification settings are invalid'
      using errcode = '22023';
  end if;

  for item in
    select value from jsonb_array_elements(coalesce(payload, '[]'::jsonb))
  loop
    select series.*
    into target_series
    from public.tournament_series as series
    where series.id = nullif(item->>'series_id', '')::uuid
      and series.tournament_id = target_tournament.id
    for update;

    if target_series.id is null then
      raise exception 'Tournament series not found' using errcode = 'P0002';
    end if;

    qualifier_count := coalesce(nullif(item->>'finals_qualifier_count', '')::integer, 0);

    if qualifier_count < 0
      or qualifier_count = 1
      or qualifier_count > target_series.capacity
    then
      raise exception 'Tournament qualifier count is invalid'
        using errcode = '22023';
    end if;

    update public.tournament_series
    set finals_qualifier_count = qualifier_count
    where id = target_series.id;
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
    'finals_qualification_configured',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object('series', coalesce(payload, '[]'::jsonb)),
    auth.uid()
  );
end;
$$;

revoke all on function public.admin_save_tournament_series_qualifiers(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.admin_save_tournament_series_qualifiers(uuid, jsonb)
to authenticated;

-- Projection sportive commune à toutes les poules d'une même série.
-- Le classement général est volontairement distinct du classement de poule :
-- il normalise les métriques selon le règlement afin de comparer des équipes
-- ayant éventuellement joué un nombre de matchs différent.
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
  ), seeded as (
    select
      calculated.*,
      row_number() over (
        order by
          calculated.ranking_value desc,
          calculated.goal_average_value desc,
          calculated.points_for_per_match desc,
          calculated.win_percentage desc,
          calculated.team_label,
          calculated.team_id
      )::integer as seed,
      count(*) over (
        partition by
          calculated.ranking_value,
          calculated.goal_average_value,
          calculated.points_for_per_match,
          calculated.win_percentage
      )::integer as tie_count,
      min(row_number_placeholder) over () as unused
    from (
      select calculated.*, 1 as row_number_placeholder
      from calculated
    ) as calculated
  ), tie_bounds as (
    select
      seeded.*,
      min(seeded.seed) over (
        partition by
          seeded.ranking_value,
          seeded.goal_average_value,
          seeded.points_for_per_match,
          seeded.win_percentage
      )::integer as tie_first_position,
      max(seeded.seed) over (
        partition by
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

revoke all on function public.tournament_general_ranking_rows(uuid, uuid)
from public, anon, authenticated;

create or replace function public.get_tournament_general_rankings(
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
      select jsonb_agg(series_payload order by display_order, series_name)
      from (
        select
          series.display_order,
          series.name as series_name,
          jsonb_build_object(
            'id', series.id,
            'name', series.name,
            'qualifier_count', series.finals_qualifier_count,
            'total_teams', (
              select count(*)::integer
              from public.tournament_general_ranking_rows(
                target_tournament.id,
                series.id
              )
            ),
            'total_matches', (
              select count(*)::integer
              from public.tournament_matches as match
              join public.tournament_pools as pool on pool.id = match.pool_id
              where pool.tournament_id = target_tournament.id
                and pool.series_id = series.id
            ),
            'validated_matches', (
              select count(*)::integer
              from public.tournament_matches as match
              join public.tournament_pools as pool on pool.id = match.pool_id
              join public.tournament_match_results as result
                on result.match_id = match.id
               and result.status = 'validated'
              where pool.tournament_id = target_tournament.id
                and pool.series_id = series.id
            ),
            'cutoff_tie', coalesce((
              select bool_or(
                series.finals_qualifier_count > 0
                and ranking.tie_first_position <= series.finals_qualifier_count
                and ranking.tie_last_position > series.finals_qualifier_count
              )
              from public.tournament_general_ranking_rows(
                target_tournament.id,
                series.id
              ) as ranking
            ), false),
            'teams', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'position', ranking.position,
                  'team_id', ranking.team_id,
                  'team_label', ranking.team_label,
                  'pool_number', ranking.pool_number,
                  'matches_played', ranking.matches_played,
                  'total_matches', ranking.total_matches,
                  'wins', ranking.wins,
                  'losses', ranking.losses,
                  'ranking_points', ranking.ranking_points,
                  'ranking_value', ranking.ranking_value,
                  'points_for', ranking.points_for,
                  'points_against', ranking.points_against,
                  'point_difference', ranking.point_difference,
                  'goal_average_value', ranking.goal_average_value,
                  'points_for_per_match', ranking.points_for_per_match,
                  'win_percentage', ranking.win_percentage,
                  'is_tied', ranking.tie_count > 1,
                  'qualification_status', case
                    when series.finals_qualifier_count = 0 then 'not_configured'
                    when ranking.tie_first_position <= series.finals_qualifier_count
                      and ranking.tie_last_position > series.finals_qualifier_count
                      then 'cutoff_tie'
                    when ranking.position <= series.finals_qualifier_count
                      then 'provisional_qualifier'
                    else 'outside'
                  end
                )
                order by ranking.position
              )
              from public.tournament_general_ranking_rows(
                target_tournament.id,
                series.id
              ) as ranking
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

revoke all on function public.get_tournament_general_rankings(uuid)
from public;
grant execute on function public.get_tournament_general_rankings(uuid)
to anon, authenticated;

-- Recalcule le seed général d'une équipe après un score hypothétique sur un
-- match encore non validé. Le Result Engine reste l'autorité sur la validité du
-- score et le calcul des points de classement.
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
  ), ranked as (
    select
      metrics.team_id,
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
  )
  select ranked.seed
  into simulated_seed
  from ranked
  where ranked.team_id = target_team_id;

  return simulated_seed;
end;
$$;

revoke all on function public.tournament_simulated_general_seed(uuid, uuid, uuid, jsonb, uuid)
from public, anon, authenticated;

create or replace function public.tournament_team_qualification_scenario(
  target_tournament_id uuid,
  target_series_id uuid,
  target_team_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  series public.tournament_series;
  rules public.tournament_sporting_rules;
  ranking record;
  remaining_match public.tournament_matches;
  team_remaining integer := 0;
  unrelated_remaining integer := 0;
  series_remaining integer := 0;
  target_points integer;
  margin integer;
  simulated_seed integer;
  best_seed integer := null;
  worst_seed integer := null;
  minimum_win_margin integer := null;
  maximum_qualifying_loss_margin integer := null;
  qualifying_wins integer := 0;
  qualifying_losses integer := 0;
  total_win_scenarios integer := 0;
  total_loss_scenarios integer := 0;
  score jsonb;
  status text;
  message text;
begin
  select tournament_series.*
  into series
  from public.tournament_series as tournament_series
  where tournament_series.id = target_series_id
    and tournament_series.tournament_id = target_tournament_id;

  if series.id is null then
    return null;
  end if;

  select sporting_rules.*
  into rules
  from public.tournament_sporting_rules as sporting_rules
  where sporting_rules.tournament_id = target_tournament_id;

  select *
  into ranking
  from public.tournament_general_ranking_rows(
    target_tournament_id,
    target_series_id
  ) as row
  where row.team_id = target_team_id;

  if ranking.team_id is null then
    return null;
  end if;

  if series.finals_qualifier_count = 0 then
    return jsonb_build_object(
      'tournament_id', target_tournament_id,
      'series_id', target_series_id,
      'team_id', target_team_id,
      'status', 'not_configured',
      'current_position', ranking.position,
      'qualifier_count', 0,
      'remaining_matches', ranking.total_matches - ranking.matches_played,
      'best_possible_position', null,
      'worst_possible_position', null,
      'minimum_win_margin', null,
      'depends_on_others', true,
      'message', 'Le nombre de qualifiés n’est pas encore configuré pour cette série.'
    );
  end if;

  select count(*)::integer
  into series_remaining
  from public.tournament_matches as match
  join public.tournament_pools as pool on pool.id = match.pool_id
  left join public.tournament_match_results as result
    on result.match_id = match.id
   and result.status = 'validated'
  where pool.tournament_id = target_tournament_id
    and pool.series_id = target_series_id
    and result.id is null;

  team_remaining := greatest(ranking.total_matches - ranking.matches_played, 0);

  if series_remaining = 0 then
    if ranking.position <= series.finals_qualifier_count then
      status := 'qualified';
      message := format(
        'Qualification acquise : votre équipe termine %se sur %s qualifiés.',
        ranking.position,
        series.finals_qualifier_count
      );
    else
      status := 'eliminated';
      message := format(
        'Phase de poules terminée : votre équipe termine %se, hors des %s places qualificatives.',
        ranking.position,
        series.finals_qualifier_count
      );
    end if;

    return jsonb_build_object(
      'tournament_id', target_tournament_id,
      'series_id', target_series_id,
      'team_id', target_team_id,
      'status', status,
      'current_position', ranking.position,
      'qualifier_count', series.finals_qualifier_count,
      'remaining_matches', 0,
      'best_possible_position', ranking.position,
      'worst_possible_position', ranking.position,
      'minimum_win_margin', null,
      'depends_on_others', false,
      'message', message
    );
  end if;

  if team_remaining = 1 then
    select match.*
    into remaining_match
    from public.tournament_matches as match
    join public.tournament_pools as pool on pool.id = match.pool_id
    left join public.tournament_match_results as result
      on result.match_id = match.id
     and result.status = 'validated'
    where pool.tournament_id = target_tournament_id
      and pool.series_id = target_series_id
      and target_team_id in (match.team_a_id, match.team_b_id)
      and result.id is null
    order by match.display_order, match.id
    limit 1;

    select count(*)::integer
    into unrelated_remaining
    from public.tournament_matches as match
    join public.tournament_pools as pool on pool.id = match.pool_id
    left join public.tournament_match_results as result
      on result.match_id = match.id
     and result.status = 'validated'
    where pool.tournament_id = target_tournament_id
      and pool.series_id = target_series_id
      and target_team_id not in (match.team_a_id, match.team_b_id)
      and result.id is null;
  end if;

  -- Cas précis actuellement utilisé au tournoi PCL : dernière partie en jeu
  -- simple et tous les autres matchs de la série déjà figés. On simule chaque
  -- score légal afin de ne jamais annoncer un écart approximatif.
  if team_remaining = 1
    and unrelated_remaining = 0
    and remaining_match.id is not null
    and rules.match_format = 'single_game'
  then
    target_points := rules.single_game_points;

    for margin in 1..target_points
    loop
      total_win_scenarios := total_win_scenarios + 1;
      if remaining_match.team_a_id = target_team_id then
        score := jsonb_build_object(
          'sets', jsonb_build_array(jsonb_build_object(
            'team_a', target_points,
            'team_b', target_points - margin
          ))
        );
      else
        score := jsonb_build_object(
          'sets', jsonb_build_array(jsonb_build_object(
            'team_a', target_points - margin,
            'team_b', target_points
          ))
        );
      end if;

      simulated_seed := public.tournament_simulated_general_seed(
        target_tournament_id,
        target_series_id,
        remaining_match.id,
        score,
        target_team_id
      );

      best_seed := least(coalesce(best_seed, simulated_seed), simulated_seed);
      worst_seed := greatest(coalesce(worst_seed, simulated_seed), simulated_seed);

      if simulated_seed <= series.finals_qualifier_count then
        qualifying_wins := qualifying_wins + 1;
        minimum_win_margin := least(coalesce(minimum_win_margin, margin), margin);
      end if;
    end loop;

    for margin in 1..target_points
    loop
      total_loss_scenarios := total_loss_scenarios + 1;
      if remaining_match.team_a_id = target_team_id then
        score := jsonb_build_object(
          'sets', jsonb_build_array(jsonb_build_object(
            'team_a', target_points - margin,
            'team_b', target_points
          ))
        );
      else
        score := jsonb_build_object(
          'sets', jsonb_build_array(jsonb_build_object(
            'team_a', target_points,
            'team_b', target_points - margin
          ))
        );
      end if;

      simulated_seed := public.tournament_simulated_general_seed(
        target_tournament_id,
        target_series_id,
        remaining_match.id,
        score,
        target_team_id
      );

      best_seed := least(coalesce(best_seed, simulated_seed), simulated_seed);
      worst_seed := greatest(coalesce(worst_seed, simulated_seed), simulated_seed);

      if simulated_seed <= series.finals_qualifier_count then
        qualifying_losses := qualifying_losses + 1;
        maximum_qualifying_loss_margin := greatest(
          coalesce(maximum_qualifying_loss_margin, margin),
          margin
        );
      end if;
    end loop;

    if qualifying_wins = total_win_scenarios
      and qualifying_losses = total_loss_scenarios
    then
      status := 'qualified';
      message := 'Qualification acquise : aucun résultat de votre dernière partie ne peut vous sortir des places qualificatives.';
    elsif qualifying_wins = 0 and qualifying_losses = 0 then
      status := 'eliminated';
      message := 'Élimination certaine : même le meilleur résultat possible lors de votre dernière partie ne permet plus d’atteindre les places qualificatives.';
    elsif qualifying_losses > 0 then
      status := 'possible';
      message := format(
        'Votre qualification est entre vos mains : une victoire vous qualifie. Une défaite de %s point(s) d’écart au maximum peut encore suffire.',
        maximum_qualifying_loss_margin
      );
    elsif minimum_win_margin is not null and minimum_win_margin > 1 then
      status := 'must_win';
      message := format(
        'Victoire obligatoire aujourd’hui avec au moins %s points d’écart pour entrer dans les %s premiers.',
        minimum_win_margin,
        series.finals_qualifier_count
      );
    else
      status := 'must_win';
      message := format(
        'Victoire obligatoire aujourd’hui pour entrer dans les %s premiers.',
        series.finals_qualifier_count
      );
    end if;

    return jsonb_build_object(
      'tournament_id', target_tournament_id,
      'series_id', target_series_id,
      'team_id', target_team_id,
      'status', status,
      'current_position', ranking.position,
      'qualifier_count', series.finals_qualifier_count,
      'remaining_matches', team_remaining,
      'best_possible_position', best_seed,
      'worst_possible_position', worst_seed,
      'minimum_win_margin', minimum_win_margin,
      'depends_on_others', false,
      'message', message
    );
  end if;

  if ranking.position <= series.finals_qualifier_count then
    status := 'provisional';
    message := format(
      'Vous êtes provisoirement %se et dans les %s places qualificatives. La situation sera recalculée après chaque résultat.',
      ranking.position,
      series.finals_qualifier_count
    );
  else
    status := 'possible';
    message := format(
      'Vous êtes actuellement %se pour %s places qualificatives. La qualification reste ouverte et dépend encore de plusieurs résultats.',
      ranking.position,
      series.finals_qualifier_count
    );
  end if;

  return jsonb_build_object(
    'tournament_id', target_tournament_id,
    'series_id', target_series_id,
    'team_id', target_team_id,
    'status', status,
    'current_position', ranking.position,
    'qualifier_count', series.finals_qualifier_count,
    'remaining_matches', team_remaining,
    'best_possible_position', null,
    'worst_possible_position', null,
    'minimum_win_margin', null,
    'depends_on_others', true,
    'message', message
  );
end;
$$;

revoke all on function public.tournament_team_qualification_scenario(uuid, uuid, uuid)
from public, anon, authenticated;

create or replace function public.get_my_tournament_qualification_scenarios()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = auth.uid();

  if current_profile.id is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      public.tournament_team_qualification_scenario(
        team.tournament_id,
        team.series_id,
        team.id
      )
      order by tournament.starts_on desc, team.id
    )
    from public.tournament_teams as team
    join public.tournaments as tournament on tournament.id = team.tournament_id
    where team.status = 'accepted'
      and tournament.status in (
        'pools_validated',
        'planning_generated',
        'planning_published',
        'in_progress',
        'completed',
        'archived'
      )
      and (
        team.submitted_by = current_profile.id
        or exists (
          select 1
          from public.tournament_team_players as player
          where player.team_id = team.id
            and (
              (
                current_profile.member_id is not null
                and player.member_id = current_profile.member_id
              )
              or (
                nullif(btrim(current_profile.email), '') is not null
                and nullif(btrim(player.email), '') is not null
                and lower(btrim(player.email)) = lower(btrim(current_profile.email))
              )
            )
        )
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_my_tournament_qualification_scenarios()
from public, anon, authenticated;
grant execute on function public.get_my_tournament_qualification_scenarios()
to authenticated;

-- Projection de la forme de la phase finale. Elle permet déjà à l'admin de
-- savoir combien d'équipes sont exemptées du barrage avant la génération réelle
-- du tableau.
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
        'main_bracket_size', case
          when series.finals_qualifier_count < 2 then 0
          else (2 ^ floor(log(2, series.finals_qualifier_count::numeric)))::integer
        end,
        'direct_qualifiers', case
          when series.finals_qualifier_count < 2 then 0
          when series.finals_qualifier_count = (2 ^ floor(log(2, series.finals_qualifier_count::numeric)))::integer
            then 0
          else 2 * (2 ^ floor(log(2, series.finals_qualifier_count::numeric)))::integer
            - series.finals_qualifier_count
        end,
        'preliminary_matches', case
          when series.finals_qualifier_count < 2 then 0
          when series.finals_qualifier_count = (2 ^ floor(log(2, series.finals_qualifier_count::numeric)))::integer
            then 0
          else series.finals_qualifier_count
            - (2 ^ floor(log(2, series.finals_qualifier_count::numeric)))::integer
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
