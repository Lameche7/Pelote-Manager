create or replace function public.admin_sync_championship_official_general_standings(
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
  v_division_key text;
  v_division_id uuid;
  v_expected_count integer;
  v_incoming_count integer;
  v_matched_count integer;
  v_updated_count integer := 0;
  v_issue_count integer := 0;
  v_partial_division_count integer := 0;
  v_issues jsonb := '[]'::jsonb;
begin
  if not public.championship_club_can_manage(target_id, v_target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'array' then
    raise exception 'Official general standings payload is invalid' using errcode = '22023';
  end if;

  for v_division_key in
    select distinct coalesce(
      nullif(btrim(value ->> 'divisionNormalized'), ''),
      public.championship_import_normalize(value ->> 'division')
    )
    from jsonb_array_elements(payload)
  loop
    v_division_id := null;

    select division.id into v_division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = v_division_key
    limit 1;

    if v_division_id is null then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'unknown_division',
        'division', v_division_key
      ));
      continue;
    end if;

    select count(*)::integer into v_expected_count
    from public.championship_teams as team
    where team.division_id = v_division_id;

    select count(*)::integer into v_incoming_count
    from jsonb_array_elements(payload) as source_row(value)
    where coalesce(
      nullif(btrim(source_row.value ->> 'divisionNormalized'), ''),
      public.championship_import_normalize(source_row.value ->> 'division')
    ) = v_division_key;

    select count(*)::integer into v_matched_count
    from jsonb_array_elements(payload) as source_row(value)
    join public.championship_pools as pool
      on pool.division_id = v_division_id
     and public.championship_import_normalize(pool.code) =
         public.championship_import_normalize(source_row.value ->> 'poolCode')
    join public.championship_teams as team
      on team.division_id = v_division_id
     and team.pool_id = pool.id
     and team.team_number = btrim(source_row.value ->> 'teamNumber')
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
     and federation_club.normalized_name = coalesce(
       nullif(btrim(source_row.value ->> 'clubNormalized'), ''),
       public.championship_import_normalize(source_row.value ->> 'clubName')
     )
    where coalesce(
      nullif(btrim(source_row.value ->> 'divisionNormalized'), ''),
      public.championship_import_normalize(source_row.value ->> 'division')
    ) = v_division_key;

    -- The FFPB publishes this ranking progressively while pool matches are being
    -- played. A partial ranking is therefore valid. We only reject the snapshot
    -- when one of the rows published by the FFPB cannot be matched safely.
    if v_incoming_count = 0 or v_matched_count <> v_incoming_count then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'unmatched_general_standings',
        'division', v_division_key,
        'expectedCount', v_expected_count,
        'incomingCount', v_incoming_count,
        'matchedCount', v_matched_count
      ));
      continue;
    end if;

    if v_incoming_count < v_expected_count then
      v_partial_division_count := v_partial_division_count + 1;
    end if;

    -- Replace the previous snapshot for this division with exactly what the
    -- federation currently publishes. This lets the provisional ranking grow
    -- naturally from one synchronization to the next.
    delete from public.championship_general_standings
    where division_id = v_division_id;

    insert into public.championship_general_standings (
      division_id,
      pool_id,
      team_id,
      rank,
      pool_rank,
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
    )
    select
      v_division_id,
      pool.id,
      team.id,
      (source_row.value ->> 'rank')::integer,
      nullif(source_row.value ->> 'poolRank', '')::integer,
      nullif(source_row.value ->> 'played', '')::integer,
      nullif(source_row.value ->> 'wins', '')::integer,
      nullif(source_row.value ->> 'draws', '')::integer,
      nullif(source_row.value ->> 'losses', '')::integer,
      nullif(source_row.value ->> 'points', '')::numeric,
      nullif(source_row.value ->> 'scoreFor', '')::integer,
      nullif(source_row.value ->> 'scoreAgainst', '')::integer,
      nullif(source_row.value ->> 'scoreDifference', '')::integer,
      coalesce(source_row.value -> 'sourcePayload', '{}'::jsonb),
      null,
      now()
    from jsonb_array_elements(payload) as source_row(value)
    join public.championship_pools as pool
      on pool.division_id = v_division_id
     and public.championship_import_normalize(pool.code) =
         public.championship_import_normalize(source_row.value ->> 'poolCode')
    join public.championship_teams as team
      on team.division_id = v_division_id
     and team.pool_id = pool.id
     and team.team_number = btrim(source_row.value ->> 'teamNumber')
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
     and federation_club.normalized_name = coalesce(
       nullif(btrim(source_row.value ->> 'clubNormalized'), ''),
       public.championship_import_normalize(source_row.value ->> 'clubName')
     )
    where coalesce(
      nullif(btrim(source_row.value ->> 'divisionNormalized'), ''),
      public.championship_import_normalize(source_row.value ->> 'division')
    ) = v_division_key;

    v_updated_count := v_updated_count + v_incoming_count;
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
    'championship.official_general_standings_synced',
    jsonb_build_object(
      'updatedCount', v_updated_count,
      'issueCount', v_issue_count,
      'partialDivisionCount', v_partial_division_count,
      'issues', v_issues
    )
  );

  return jsonb_build_object(
    'updatedCount', v_updated_count,
    'issueCount', v_issue_count,
    'partialDivisionCount', v_partial_division_count,
    'issues', v_issues
  );
end;
$$;

revoke all on function public.admin_sync_championship_official_general_standings(uuid, jsonb)
  from public, anon;
grant execute on function public.admin_sync_championship_official_general_standings(uuid, jsonb)
  to authenticated;
