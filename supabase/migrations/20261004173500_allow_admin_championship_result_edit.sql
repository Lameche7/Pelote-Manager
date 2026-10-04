begin;

create or replace function public.admin_submit_championship_result(
  target_match_id uuid,
  target_score_team1 integer,
  target_score_team2 integer,
  target_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid := public.admin_current_club_id();
  match_row public.championship_matches%rowtype;
  championship_id uuid;
  result_input_mode text;
  result_winning_score integer;
  club_team_id uuid;
  submission_id uuid;
  effective_starts_at timestamptz;
begin
  if actor_id is null or target_club_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select match.*
  into match_row
  from public.championship_matches as match
  where match.id = target_match_id;

  if match_row.id is null then
    raise exception 'Championship match not found' using errcode = 'P0002';
  end if;

  select
    championship.id,
    championship.result_input_mode,
    championship.result_winning_score
  into
    championship_id,
    result_input_mode,
    result_winning_score
  from public.championship_divisions as division
  join public.championships as championship
    on championship.id = division.championship_id
  where division.id = match_row.division_id;

  if not public.championship_club_can_manage(championship_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if result_input_mode is null or result_winning_score is null then
    raise exception 'Result input settings not configured' using errcode = '22023';
  end if;

  if target_score_team1 is null
    or target_score_team2 is null
    or target_score_team1 not between 0 and 999
    or target_score_team2 not between 0 and 999
    or target_score_team1 = target_score_team2
    or greatest(target_score_team1, target_score_team2) <> result_winning_score
    or least(target_score_team1, target_score_team2) >= result_winning_score
  then
    raise exception 'Invalid score for championship settings' using errcode = '22023';
  end if;

  if match_row.status in ('cancelled', 'forfeit')
    or match_row.score_raw is not null
    or match_row.score_team1 is not null
    or match_row.score_team2 is not null
  then
    raise exception 'Official result already available or match unavailable' using errcode = '22023';
  end if;

  select effective.starts_at
  into effective_starts_at
  from public.championship_match_effective_schedule(target_match_id) as effective;

  if effective_starts_at is not null
    and effective_starts_at > now()
    and match_row.status <> 'played'
  then
    raise exception 'Match has not started' using errcode = '22023';
  end if;

  select team.id
  into club_team_id
  from public.championship_teams as team
  join public.championship_federation_clubs as federation_club
    on federation_club.id = team.federation_club_id
  where team.id in (match_row.team1_id, match_row.team2_id)
    and federation_club.linked_club_id = target_club_id
  order by case when team.id = match_row.team1_id then 0 else 1 end
  limit 1;

  if club_team_id is null then
    raise exception 'Match does not belong to current club' using errcode = '42501';
  end if;

  update public.championship_result_submissions as previous
  set status = 'withdrawn',
      resolved_at = now(),
      updated_at = now()
  where previous.match_id = target_match_id
    and previous.status = 'pending';

  insert into public.championship_result_submissions (
    match_id,
    team_id,
    submitted_by,
    score_team1,
    score_team2,
    comment
  )
  values (
    target_match_id,
    club_team_id,
    actor_id,
    target_score_team1,
    target_score_team2,
    nullif(btrim(target_comment), '')
  )
  returning id into submission_id;

  insert into public.championship_audit_log (
    championship_id,
    actor_id,
    action,
    payload
  )
  values (
    championship_id,
    actor_id,
    'result_submission.admin_saved',
    jsonb_build_object(
      'submissionId', submission_id,
      'matchId', target_match_id,
      'teamId', club_team_id,
      'inputMode', result_input_mode,
      'winningScore', result_winning_score,
      'scoreTeam1', target_score_team1,
      'scoreTeam2', target_score_team2
    )
  );

  return jsonb_build_object(
    'id', submission_id,
    'matchId', target_match_id,
    'teamId', club_team_id,
    'scoreTeam1', target_score_team1,
    'scoreTeam2', target_score_team2,
    'status', 'pending'
  );
end;
$function$;

revoke all on function public.admin_submit_championship_result(uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.admin_submit_championship_result(uuid, integer, integer, text)
  to authenticated;

commit;
