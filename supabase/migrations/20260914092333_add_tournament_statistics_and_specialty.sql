alter table public.tournament_sporting_rules
add column if not exists specialty text;

create or replace function public.admin_get_tournament_specialty(target_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  result text;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select coalesce(rules.specialty, '')
  into result
  from public.tournament_sporting_rules as rules
  join public.tournaments as tournament
    on tournament.id = rules.tournament_id
  where rules.tournament_id = target_id
    and tournament.club_id = target_club_id;

  if result is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function public.admin_set_tournament_specialty(
  target_id uuid,
  target_specialty text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  normalized_specialty text := btrim(coalesce(target_specialty, ''));
  previous_specialty text;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if normalized_specialty = '' then
    raise exception 'Tournament specialty is required' using errcode = '22023';
  end if;

  select rules.specialty
  into previous_specialty
  from public.tournament_sporting_rules as rules
  join public.tournaments as tournament
    on tournament.id = rules.tournament_id
  where rules.tournament_id = target_id
    and tournament.club_id = target_club_id
  for update of rules;

  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  update public.tournament_sporting_rules
  set specialty = normalized_specialty,
      updated_at = now()
  where tournament_id = target_id;

  if previous_specialty is distinct from normalized_specialty then
    insert into public.tournament_audit_log (
      tournament_id,
      action,
      payload,
      created_by
    )
    values (
      target_id,
      'specialty_updated',
      jsonb_build_object(
        'before', previous_specialty,
        'after', normalized_specialty
      ),
      auth.uid()
    );
  end if;
end;
$$;

create or replace function public.get_my_tournament_statistics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  result jsonb;
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  with my_teams as (
    select distinct
      team.id,
      team.tournament_id,
      team.series_id
    from public.tournament_teams as team
    where team.status in ('pending', 'accepted')
      and public.tournament_profile_is_linked_to_team(
        team.id,
        current_profile_id
      )
  ),
  statistic_rows as (
    select
      tournament_match.id as match_id,
      tournament.id as tournament_id,
      tournament.name as tournament_name,
      coalesce(nullif(btrim(sporting_rules.specialty), ''), 'Discipline non renseignée') as specialty,
      season.name as season_label,
      series.id as series_id,
      series.name as series_name,
      case
        when tournament_match.phase = 'pools' then 'Poules'
        else coalesce(nullif(tournament_match.final_round, ''), 'Phase finale')
      end as phase_label,
      case when tournament_match.team_a_id = my_team.id then 'a' else 'b' end as team_side,
      coalesce(nullif(opponent_names.label, ''), 'Équipe adverse') as opponent_label,
      planning.play_date,
      case
        when tournament_match.team_a_id = my_team.id then match_result.team_a_points
        else match_result.team_b_points
      end as score_mine,
      case
        when tournament_match.team_a_id = my_team.id then match_result.team_b_points
        else match_result.team_a_points
      end as score_opponent,
      match_result.winner_team_id = my_team.id as won,
      sporting_rules.match_format::text as match_format,
      sporting_rules.single_game_points,
      sporting_rules.main_set_points,
      sporting_rules.deciding_set_points
    from my_teams as my_team
    join public.tournaments as tournament
      on tournament.id = my_team.tournament_id
    join public.club_seasons as season
      on season.id = tournament.season_id
    join public.tournament_series as series
      on series.id = my_team.series_id
    join public.tournament_sporting_rules as sporting_rules
      on sporting_rules.tournament_id = tournament.id
    join public.tournament_matches as tournament_match
      on tournament_match.tournament_id = tournament.id
     and my_team.id in (tournament_match.team_a_id, tournament_match.team_b_id)
    join public.tournament_match_results as match_result
      on match_result.match_id = tournament_match.id
     and match_result.status = 'validated'
     and match_result.winner_team_id is not null
    left join public.tournament_match_planning as planning
      on planning.match_id = tournament_match.id
    join public.tournament_teams as opponent
      on opponent.id = case
        when tournament_match.team_a_id = my_team.id then tournament_match.team_b_id
        else tournament_match.team_a_id
      end
    left join lateral (
      select string_agg(
        btrim(concat_ws(' ', player.first_name, player.last_name)),
        ' / '
        order by player.display_order
      ) as label
      from public.tournament_team_players as player
      where player.team_id = opponent.id
    ) as opponent_names on true
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'match_id', row.match_id,
        'tournament_id', row.tournament_id,
        'tournament_name', row.tournament_name,
        'specialty', row.specialty,
        'season_label', row.season_label,
        'series_id', row.series_id,
        'series_name', row.series_name,
        'phase', row.phase_label,
        'team_side', row.team_side,
        'opponent_label', row.opponent_label,
        'play_date', row.play_date,
        'score_mine', row.score_mine,
        'score_opponent', row.score_opponent,
        'won', row.won,
        'match_format', row.match_format,
        'single_game_points', row.single_game_points,
        'main_set_points', row.main_set_points,
        'deciding_set_points', row.deciding_set_points
      )
      order by row.play_date desc nulls last, row.tournament_name, row.match_id
    ),
    '[]'::jsonb
  )
  into result
  from statistic_rows as row;

  return result;
end;
$$;

revoke all on function public.admin_get_tournament_specialty(uuid)
from public, anon, authenticated;
revoke all on function public.admin_set_tournament_specialty(uuid, text)
from public, anon, authenticated;
revoke all on function public.get_my_tournament_statistics()
from public, anon, authenticated;

grant execute on function public.admin_get_tournament_specialty(uuid)
to authenticated;
grant execute on function public.admin_set_tournament_specialty(uuid, text)
to authenticated;
grant execute on function public.get_my_tournament_statistics()
to authenticated;
