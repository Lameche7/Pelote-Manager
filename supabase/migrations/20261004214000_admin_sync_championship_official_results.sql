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
  v_target_club_id uuid := public.admin_current_club_id();
  v_actor_id uuid := auth.uid();
  v_source_row jsonb;
  v_division_id uuid;
  v_team1_id uuid;
  v_team2_id uuid;
  v_target_match_id uuid;
  v_candidate_count integer;
  v_score1 integer;
  v_score2 integer;
  v_source_date date;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_issue_count integer := 0;
  v_issues jsonb := '[]'::jsonb;
  v_processed_count integer := 0;
begin
  if not public.championship_club_can_manage(target_id, v_target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'array' then
    raise exception 'Official championship results payload is invalid' using errcode = '22023';
  end if;

  for v_source_row in select * from jsonb_array_elements(payload)
  loop
    v_processed_count := v_processed_count + 1;
    v_score1 := nullif(v_source_row ->> 'scoreTeam1', '')::integer;
    v_score2 := nullif(v_source_row ->> 'scoreTeam2', '')::integer;
    v_source_date := nullif(v_source_row ->> 'sourceDate', '')::date;

    if v_score1 is null or v_score2 is null
      or v_score1 not between 0 and 200
      or v_score2 not between 0 and 200
      or v_score1 = v_score2
    then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_score',
        'division', v_source_row ->> 'division',
        'team1', v_source_row #>> '{team1,clubName}',
        'team2', v_source_row #>> '{team2,clubName}'
      ));
      continue;
    end if;

    select division.id into v_division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = public.championship_import_normalize(v_source_row ->> 'division')
    limit 1;

    if v_division_id is null then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'unknown_division',
        'division', v_source_row ->> 'division'
      ));
      continue;
    end if;

    select team.id into v_team1_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = v_division_id
      and federation_club.normalized_name = public.championship_import_normalize(v_source_row #>> '{team1,clubName}')
      and team.team_number = btrim(v_source_row #>> '{team1,teamNumber}')
    limit 1;

    select team.id into v_team2_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = v_division_id
      and federation_club.normalized_name = public.championship_import_normalize(v_source_row #>> '{team2,clubName}')
      and team.team_number = btrim(v_source_row #>> '{team2,teamNumber}')
    limit 1;

    if v_team1_id is null or v_team2_id is null then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'unknown_team',
        'division', v_source_row ->> 'division',
        'team1', v_source_row #>> '{team1,clubName}',
        'team1Number', v_source_row #>> '{team1,teamNumber}',
        'team2', v_source_row #>> '{team2,clubName}',
        'team2Number', v_source_row #>> '{team2,teamNumber}'
      ));
      continue;
    end if;

    select count(*), min(match.id::text)::uuid
      into v_candidate_count, v_target_match_id
    from public.championship_matches as match
    where match.division_id = v_division_id
      and match.team1_id = v_team1_id
      and match.team2_id = v_team2_id
      and public.championship_import_normalize(match.phase) =
          public.championship_import_normalize(coalesce(nullif(v_source_row ->> 'phase', ''), 'Poules'));

    if v_candidate_count > 1 and v_source_date is not null then
      select count(*), min(match.id::text)::uuid
        into v_candidate_count, v_target_match_id
      from public.championship_matches as match
      where match.division_id = v_division_id
        and match.team1_id = v_team1_id
        and match.team2_id = v_team2_id
        and public.championship_import_normalize(match.phase) =
            public.championship_import_normalize(coalesce(nullif(v_source_row ->> 'phase', ''), 'Poules'))
        and v_source_date in (match.scheduled_on, match.report_on, match.agreement_on);
    end if;

    if v_candidate_count <> 1 or v_target_match_id is null then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', case when v_candidate_count = 0 then 'match_not_found' else 'ambiguous_match' end,
        'division', v_source_row ->> 'division',
        'team1', v_source_row #>> '{team1,clubName}',
        'team1Number', v_source_row #>> '{team1,teamNumber}',
        'team2', v_source_row #>> '{team2,clubName}',
        'team2Number', v_source_row #>> '{team2,teamNumber}',
        'sourceDate', v_source_row ->> 'sourceDate'
      ));
      continue;
    end if;

    if exists (
      select 1
      from public.championship_matches as match
      where match.id = v_target_match_id
        and match.score_team1 = v_score1
        and match.score_team2 = v_score2
        and match.status = 'played'
    ) then
      v_unchanged_count := v_unchanged_count + 1;
      continue;
    end if;

    update public.championship_matches as match
    set score_team1 = v_score1,
        score_team2 = v_score2,
        score_raw = v_score1::text || '-' || v_score2::text,
        status = 'played',
        updated_at = now()
    where match.id = v_target_match_id;

    v_updated_count := v_updated_count + 1;
  end loop;

  insert into public.championship_audit_log (
    championship_id,
    club_id,
    actor_id,
    action,
    payload
  ) values (
    target_id,
    v_target_club_id,
    v_actor_id,
    'championship.official_results_synced',
    jsonb_build_object(
      'processedCount', v_processed_count,
      'updatedCount', v_updated_count,
      'unchangedCount', v_unchanged_count,
      'issueCount', v_issue_count,
      'issues', v_issues
    )
  );

  return jsonb_build_object(
    'processedCount', v_processed_count,
    'updatedCount', v_updated_count,
    'unchangedCount', v_unchanged_count,
    'issueCount', v_issue_count,
    'issues', v_issues
  );
end;
$$;

revoke all on function public.admin_sync_championship_official_results(uuid, jsonb) from public, anon;
grant execute on function public.admin_sync_championship_official_results(uuid, jsonb) to authenticated;
