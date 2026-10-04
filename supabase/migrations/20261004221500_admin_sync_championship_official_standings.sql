create or replace function public.admin_sync_championship_official_standings(
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
  v_row jsonb;
  v_division_id uuid;
  v_pool_id uuid;
  v_team_id uuid;
  v_rank integer;
  v_played integer;
  v_wins integer;
  v_draws integer;
  v_losses integer;
  v_points numeric;
  v_score_for integer;
  v_score_against integer;
  v_score_difference integer;
  v_processed_count integer := 0;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_issue_count integer := 0;
  v_issues jsonb := '[]'::jsonb;
begin
  if not public.championship_club_can_manage(target_id, v_target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'array' then
    raise exception 'Official championship standings payload is invalid' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(payload)
  loop
    v_processed_count := v_processed_count + 1;
    v_division_id := null;
    v_pool_id := null;
    v_team_id := null;

    begin
      v_rank := nullif(v_row ->> 'rank', '')::integer;
      v_played := nullif(v_row ->> 'played', '')::integer;
      v_wins := nullif(v_row ->> 'wins', '')::integer;
      v_draws := nullif(v_row ->> 'draws', '')::integer;
      v_losses := nullif(v_row ->> 'losses', '')::integer;
      v_points := nullif(v_row ->> 'points', '')::numeric;
      v_score_for := nullif(v_row ->> 'scoreFor', '')::integer;
      v_score_against := nullif(v_row ->> 'scoreAgainst', '')::integer;
      v_score_difference := nullif(v_row ->> 'scoreDifference', '')::integer;
    exception when others then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_numbers',
        'division', v_row ->> 'division',
        'poolCode', v_row ->> 'poolCode',
        'teamLabel', v_row ->> 'teamLabel'
      ));
      continue;
    end;

    if v_rank is null or v_rank <= 0 then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_rank',
        'division', v_row ->> 'division',
        'poolCode', v_row ->> 'poolCode',
        'teamLabel', v_row ->> 'teamLabel'
      ));
      continue;
    end if;

    select division.id into v_division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = public.championship_import_normalize(v_row ->> 'division')
    limit 1;

    if v_division_id is null then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'unknown_division',
        'division', v_row ->> 'division'
      ));
      continue;
    end if;

    select pool.id into v_pool_id
    from public.championship_pools as pool
    where pool.division_id = v_division_id
      and public.championship_import_normalize(pool.code) =
          public.championship_import_normalize(v_row ->> 'poolCode')
    limit 1;

    if v_pool_id is null then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'unknown_pool',
        'division', v_row ->> 'division',
        'poolCode', v_row ->> 'poolCode'
      ));
      continue;
    end if;

    select team.id into v_team_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = v_division_id
      and team.pool_id = v_pool_id
      and federation_club.normalized_name = public.championship_import_normalize(v_row ->> 'clubName')
      and team.team_number = btrim(v_row ->> 'teamNumber')
    limit 1;

    if v_team_id is null then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'unknown_team',
        'division', v_row ->> 'division',
        'poolCode', v_row ->> 'poolCode',
        'teamLabel', v_row ->> 'teamLabel'
      ));
      continue;
    end if;

    if exists (
      select 1
      from public.championship_standings as standing
      where standing.pool_id = v_pool_id
        and standing.team_id = v_team_id
        and standing.rank is not distinct from v_rank
        and standing.played is not distinct from v_played
        and standing.wins is not distinct from v_wins
        and standing.draws is not distinct from v_draws
        and standing.losses is not distinct from v_losses
        and standing.points is not distinct from v_points
        and standing.score_for is not distinct from v_score_for
        and standing.score_against is not distinct from v_score_against
        and standing.score_difference is not distinct from v_score_difference
    ) then
      v_unchanged_count := v_unchanged_count + 1;
      continue;
    end if;

    insert into public.championship_standings (
      pool_id,
      team_id,
      rank,
      played,
      wins,
      draws,
      losses,
      points,
      score_for,
      score_against,
      score_difference,
      source_payload,
      source_import_file_id,
      updated_at
    ) values (
      v_pool_id,
      v_team_id,
      v_rank,
      v_played,
      v_wins,
      v_draws,
      v_losses,
      v_points,
      v_score_for,
      v_score_against,
      v_score_difference,
      coalesce(v_row -> 'sourcePayload', '{}'::jsonb),
      null,
      now()
    )
    on conflict (pool_id, team_id) do update set
      rank = excluded.rank,
      played = excluded.played,
      wins = excluded.wins,
      draws = excluded.draws,
      losses = excluded.losses,
      points = excluded.points,
      score_for = excluded.score_for,
      score_against = excluded.score_against,
      score_difference = excluded.score_difference,
      source_payload = excluded.source_payload,
      source_import_file_id = null,
      updated_at = now();

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
    'championship.official_standings_synced',
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

revoke all on function public.admin_sync_championship_official_standings(uuid, jsonb) from public, anon;
grant execute on function public.admin_sync_championship_official_standings(uuid, jsonb) to authenticated;
