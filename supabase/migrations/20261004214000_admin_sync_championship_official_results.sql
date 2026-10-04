create or replace function public.admin_sync_championship_official_results(
  target_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  actor_id uuid := auth.uid();
  source_row jsonb;
  division_id uuid;
  team1_id uuid;
  team2_id uuid;
  target_match_id uuid;
  candidate_count integer;
  score1 integer;
  score2 integer;
  source_date date;
  updated_count integer := 0;
  unchanged_count integer := 0;
  issue_count integer := 0;
  issues jsonb := '[]'::jsonb;
  processed_count integer := 0;
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'array' then
    raise exception 'Official championship results payload is invalid' using errcode = '22023';
  end if;

  for source_row in select * from jsonb_array_elements(payload)
  loop
    processed_count := processed_count + 1;
    score1 := nullif(source_row ->> 'scoreTeam1', '')::integer;
    score2 := nullif(source_row ->> 'scoreTeam2', '')::integer;
    source_date := nullif(source_row ->> 'sourceDate', '')::date;

    if score1 is null or score2 is null
      or score1 not between 0 and 200
      or score2 not between 0 and 200
      or score1 = score2
    then
      issue_count := issue_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_score',
        'division', source_row ->> 'division',
        'team1', source_row #>> '{team1,clubName}',
        'team2', source_row #>> '{team2,clubName}'
      ));
      continue;
    end if;

    select division.id into division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = public.championship_import_normalize(source_row ->> 'division')
    limit 1;

    if division_id is null then
      issue_count := issue_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'unknown_division',
        'division', source_row ->> 'division'
      ));
      continue;
    end if;

    select team.id into team1_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = division_id
      and federation_club.normalized_name = public.championship_import_normalize(source_row #>> '{team1,clubName}')
      and team.team_number = btrim(source_row #>> '{team1,teamNumber}')
    limit 1;

    select team.id into team2_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = division_id
      and federation_club.normalized_name = public.championship_import_normalize(source_row #>> '{team2,clubName}')
      and team.team_number = btrim(source_row #>> '{team2,teamNumber}')
    limit 1;

    if team1_id is null or team2_id is null then
      issue_count := issue_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'unknown_team',
        'division', source_row ->> 'division',
        'team1', source_row #>> '{team1,clubName}',
        'team1Number', source_row #>> '{team1,teamNumber}',
        'team2', source_row #>> '{team2,clubName}',
        'team2Number', source_row #>> '{team2,teamNumber}'
      ));
      continue;
    end if;

    select count(*), min(match.id::text)::uuid
      into candidate_count, target_match_id
    from public.championship_matches as match
    where match.division_id = division_id
      and match.team1_id = team1_id
      and match.team2_id = team2_id
      and public.championship_import_normalize(match.phase) =
          public.championship_import_normalize(coalesce(nullif(source_row ->> 'phase', ''), 'Poules'));

    if candidate_count > 1 and source_date is not null then
      select count(*), min(match.id::text)::uuid
        into candidate_count, target_match_id
      from public.championship_matches as match
      where match.division_id = division_id
        and match.team1_id = team1_id
        and match.team2_id = team2_id
        and public.championship_import_normalize(match.phase) =
            public.championship_import_normalize(coalesce(nullif(source_row ->> 'phase', ''), 'Poules'))
        and source_date in (match.scheduled_on, match.report_on, match.agreement_on);
    end if;

    if candidate_count <> 1 or target_match_id is null then
      issue_count := issue_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', case when candidate_count = 0 then 'match_not_found' else 'ambiguous_match' end,
        'division', source_row ->> 'division',
        'team1', source_row #>> '{team1,clubName}',
        'team1Number', source_row #>> '{team1,teamNumber}',
        'team2', source_row #>> '{team2,clubName}',
        'team2Number', source_row #>> '{team2,teamNumber}',
        'sourceDate', source_row ->> 'sourceDate'
      ));
      continue;
    end if;

    if exists (
      select 1
      from public.championship_matches as match
      where match.id = target_match_id
        and match.score_team1 = score1
        and match.score_team2 = score2
        and match.status = 'played'
    ) then
      unchanged_count := unchanged_count + 1;
      continue;
    end if;

    update public.championship_matches as match
    set score_team1 = score1,
        score_team2 = score2,
        score_raw = score1::text || '-' || score2::text,
        status = 'played',
        updated_at = now()
    where match.id = target_match_id;

    updated_count := updated_count + 1;
  end loop;

  insert into public.championship_audit_log (
    championship_id,
    club_id,
    actor_id,
    action,
    payload
  ) values (
    target_id,
    target_club_id,
    actor_id,
    'championship.official_results_synced',
    jsonb_build_object(
      'processedCount', processed_count,
      'updatedCount', updated_count,
      'unchangedCount', unchanged_count,
      'issueCount', issue_count,
      'issues', issues
    )
  );

  return jsonb_build_object(
    'processedCount', processed_count,
    'updatedCount', updated_count,
    'unchangedCount', unchanged_count,
    'issueCount', issue_count,
    'issues', issues
  );
end;
$$;

revoke all on function public.admin_sync_championship_official_results(uuid, jsonb) from public, anon;
grant execute on function public.admin_sync_championship_official_results(uuid, jsonb) to authenticated;
