begin;

create or replace function public.admin_list_championship_day_results_v2(
  target_id uuid
)
returns table (
  match_id uuid,
  championship_id uuid,
  day_on date,
  actual_on date,
  actual_time time without time zone,
  division_id uuid,
  division_name text,
  division_display_order integer,
  pool_code text,
  team1_id uuid,
  team1_label text,
  team1_players text[],
  team1_is_club boolean,
  team2_id uuid,
  team2_label text,
  team2_players text[],
  team2_is_club boolean,
  club_is_home boolean,
  proposed_score_team1 integer,
  proposed_score_team2 integer,
  proposed_by_team_label text,
  proposal_status text,
  official_score_team1 integer,
  official_score_team2 integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  select
    match.id,
    division.championship_id,
    coalesce(match.scheduled_on, match.report_on, match.agreement_on),
    coalesce(manual.scheduled_on, match.agreement_on, match.report_on, match.scheduled_on),
    coalesce(manual.scheduled_time, match.agreement_time, match.report_time, match.scheduled_time),
    division.id,
    division.name,
    division.display_order,
    pool.code,
    team1.id,
    team1.source_label,
    coalesce(team1_players.names, array[]::text[]),
    club1.linked_club_id = target_club_id,
    team2.id,
    team2.source_label,
    coalesce(team2_players.names, array[]::text[]),
    club2.linked_club_id = target_club_id,
    club1.linked_club_id = target_club_id,
    proposal.score_team1,
    proposal.score_team2,
    proposal_team.source_label,
    proposal.status::text,
    match.score_team1,
    match.score_team2
  from public.championship_matches as match
  join public.championship_divisions as division
    on division.id = match.division_id
  join public.championship_teams as team1
    on team1.id = match.team1_id
  join public.championship_federation_clubs as club1
    on club1.id = team1.federation_club_id
  join public.championship_teams as team2
    on team2.id = match.team2_id
  join public.championship_federation_clubs as club2
    on club2.id = team2.federation_club_id
  left join public.championship_pools as pool
    on pool.id = match.pool_id
  left join public.championship_match_manual_schedules as manual
    on manual.match_id = match.id
  left join lateral (
    select array_agg(
      btrim(concat_ws(' ', player.first_name, player.last_name))
      order by player.last_name, player.first_name
    ) as names
    from public.championship_team_players as team_player
    join public.championship_players as player
      on player.id = team_player.player_id
    where team_player.team_id = team1.id
  ) as team1_players on true
  left join lateral (
    select array_agg(
      btrim(concat_ws(' ', player.first_name, player.last_name))
      order by player.last_name, player.first_name
    ) as names
    from public.championship_team_players as team_player
    join public.championship_players as player
      on player.id = team_player.player_id
    where team_player.team_id = team2.id
  ) as team2_players on true
  left join lateral (
    select submission.*
    from public.championship_result_submissions as submission
    join public.championship_teams as submission_team
      on submission_team.id = submission.team_id
    join public.championship_federation_clubs as submission_club
      on submission_club.id = submission_team.federation_club_id
    where submission.match_id = match.id
      and submission_club.linked_club_id = target_club_id
    order by submission.updated_at desc, submission.created_at desc
    limit 1
  ) as proposal on true
  left join public.championship_teams as proposal_team
    on proposal_team.id = proposal.team_id
  where division.championship_id = target_id
    and (
      club1.linked_club_id = target_club_id
      or club2.linked_club_id = target_club_id
    )
  order by
    division.display_order,
    coalesce(match.scheduled_on, match.report_on, match.agreement_on),
    pool.display_order,
    (club1.linked_club_id = target_club_id) desc,
    team1.source_label,
    team2.source_label;
end;
$function$;

revoke all on function public.admin_list_championship_day_results_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_list_championship_day_results_v2(uuid)
  to authenticated;

commit;
