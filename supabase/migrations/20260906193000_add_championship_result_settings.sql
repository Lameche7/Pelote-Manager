alter table public.championships
  add column result_input_mode text,
  add column result_winning_score integer;

alter table public.championships
  add constraint championships_result_input_mode_check
    check (result_input_mode is null or result_input_mode in ('points', 'sets')),
  add constraint championships_result_winning_score_check
    check (result_winning_score is null or result_winning_score between 1 and 999),
  add constraint championships_result_settings_pair_check
    check ((result_input_mode is null) = (result_winning_score is null));

alter table public.championship_result_submissions
  drop constraint if exists championship_result_submissions_score_team1_check,
  drop constraint if exists championship_result_submissions_score_team2_check,
  drop constraint if exists championship_result_submissions_official_score_team1_check,
  drop constraint if exists championship_result_submissions_official_score_team2_check;

alter table public.championship_result_submissions
  add constraint championship_result_submissions_score_team1_check
    check (score_team1 between 0 and 999),
  add constraint championship_result_submissions_score_team2_check
    check (score_team2 between 0 and 999),
  add constraint championship_result_submissions_official_score_team1_check
    check (official_score_team1 is null or official_score_team1 between 0 and 999),
  add constraint championship_result_submissions_official_score_team2_check
    check (official_score_team2 is null or official_score_team2 between 0 and 999);

create or replace function public.admin_get_championship_result_settings(target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  result jsonb;
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'championshipId', championship.id,
    'inputMode', championship.result_input_mode,
    'winningScore', championship.result_winning_score
  )
  into result
  from public.championships as championship
  where championship.id = target_id;

  if result is null then
    raise exception 'Championship not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function public.admin_update_championship_result_settings(
  target_id uuid,
  input_mode text,
  winning_score integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid := public.admin_current_club_id();
  normalized_mode text := nullif(btrim(input_mode), '');
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if normalized_mode not in ('points', 'sets')
    or winning_score is null
    or winning_score not between 1 and 999
  then
    raise exception 'Invalid championship result settings' using errcode = '22023';
  end if;

  update public.championships
  set result_input_mode = normalized_mode,
      result_winning_score = winning_score,
      updated_by = actor_id,
      updated_at = now()
  where id = target_id;

  if not found then
    raise exception 'Championship not found' using errcode = 'P0002';
  end if;

  insert into public.championship_audit_log (
    championship_id,
    club_id,
    actor_id,
    action,
    payload
  )
  values (
    target_id,
    target_club_id,
    actor_id,
    'result_settings.updated',
    jsonb_build_object(
      'inputMode', normalized_mode,
      'winningScore', winning_score
    )
  );

  return jsonb_build_object(
    'championshipId', target_id,
    'inputMode', normalized_mode,
    'winningScore', winning_score
  );
end;
$$;

create or replace function public.get_my_championship_result_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select distinct championship.id
    from public.championship_players as player
    join public.championship_team_players as team_player
      on team_player.player_id = player.id
    join public.championship_teams as team
      on team.id = team_player.team_id
    join public.championship_divisions as division
      on division.id = team.division_id
    join public.championships as championship
      on championship.id = division.championship_id
    where player.profile_id = auth.uid()
      and player.link_status in ('claimed', 'verified')
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'championship_id', championship.id,
        'input_mode', championship.result_input_mode,
        'winning_score', championship.result_winning_score
      )
      order by championship.id
    ),
    '[]'::jsonb
  )
  from mine
  join public.championships as championship
    on championship.id = mine.id;
$$;

create or replace function public.submit_my_championship_result(
  target_match_id uuid,
  target_score_mine integer,
  target_score_opponent integer,
  target_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  match_row public.championship_matches%rowtype;
  my_team_id uuid;
  canonical_score_team1 integer;
  canonical_score_team2 integer;
  submission_id uuid;
  championship_id uuid;
  result_input_mode text;
  result_winning_score integer;
begin
  if actor_id is null then
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

  if result_input_mode is null or result_winning_score is null then
    raise exception 'Result input settings not configured' using errcode = '22023';
  end if;

  if target_score_mine is null
    or target_score_opponent is null
    or target_score_mine not between 0 and 999
    or target_score_opponent not between 0 and 999
    or target_score_mine = target_score_opponent
    or greatest(target_score_mine, target_score_opponent) <> result_winning_score
    or least(target_score_mine, target_score_opponent) >= result_winning_score
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

  if coalesce(match_row.agreement_on, match_row.report_on, match_row.scheduled_on)
      > (now() at time zone 'Europe/Paris')::date
    and match_row.status <> 'played'
  then
    raise exception 'Match has not started' using errcode = '22023';
  end if;

  select team.id
  into my_team_id
  from public.championship_teams as team
  where team.id in (match_row.team1_id, match_row.team2_id)
    and exists (
      select 1
      from public.championship_team_players as team_player
      join public.championship_players as player
        on player.id = team_player.player_id
      where team_player.team_id = team.id
        and player.profile_id = actor_id
        and player.link_status in ('claimed', 'verified')
    )
  order by case when team.id = match_row.team1_id then 0 else 1 end
  limit 1;

  if my_team_id is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if my_team_id = match_row.team1_id then
    canonical_score_team1 := target_score_mine;
    canonical_score_team2 := target_score_opponent;
  else
    canonical_score_team1 := target_score_opponent;
    canonical_score_team2 := target_score_mine;
  end if;

  update public.championship_result_submissions as previous
  set status = 'withdrawn',
      resolved_at = now(),
      updated_at = now()
  where previous.match_id = target_match_id
    and previous.team_id = my_team_id
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
    my_team_id,
    actor_id,
    canonical_score_team1,
    canonical_score_team2,
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
    'result_submission.created',
    jsonb_build_object(
      'submissionId', submission_id,
      'matchId', target_match_id,
      'teamId', my_team_id,
      'inputMode', result_input_mode,
      'winningScore', result_winning_score,
      'scoreTeam1', canonical_score_team1,
      'scoreTeam2', canonical_score_team2
    )
  );

  return jsonb_build_object(
    'id', submission_id,
    'matchId', target_match_id,
    'teamId', my_team_id,
    'scoreMine', target_score_mine,
    'scoreOpponent', target_score_opponent,
    'status', 'pending'
  );
end;
$$;

revoke all on function public.admin_get_championship_result_settings(uuid) from public, anon, authenticated;
revoke all on function public.admin_update_championship_result_settings(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.get_my_championship_result_settings() from public, anon, authenticated;
revoke all on function public.submit_my_championship_result(uuid, integer, integer, text) from public, anon, authenticated;

grant execute on function public.admin_get_championship_result_settings(uuid) to authenticated;
grant execute on function public.admin_update_championship_result_settings(uuid, text, integer) to authenticated;
grant execute on function public.get_my_championship_result_settings() to authenticated;
grant execute on function public.submit_my_championship_result(uuid, integer, integer, text) to authenticated;
