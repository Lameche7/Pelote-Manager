create or replace function public.admin_get_championship_detail(target_id uuid)
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
    'id', championship.id,
    'name', championship.name,
    'specialty', championship.specialty,
    'season_label', championship.season_label,
    'status', championship.status,
    'source_url', championship.source_url,
    'updated_at', championship.updated_at,
    'last_import_at', (
      select max(batch.applied_at)
      from public.championship_import_batches as batch
      where batch.championship_id = championship.id
        and batch.status = 'applied'
    ),
    'divisions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', division.id,
          'name', division.name,
          'pools', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'id', pool.id,
                'code', pool.code,
                'name', pool.name
              ) order by pool.display_order, pool.code
            ), '[]'::jsonb)
            from public.championship_pools as pool
            where pool.division_id = division.id
          )
        ) order by division.display_order, division.name
      ), '[]'::jsonb)
      from public.championship_divisions as division
      where division.championship_id = championship.id
    ),
    'teams', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', team.id,
          'division_id', team.division_id,
          'club_name', federation_club.name,
          'team_number', team.team_number,
          'source_label', team.source_label,
          'pool_code', pool.code,
          'players', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'id', player.id,
                'licence_number', player.licence_number,
                'first_name', player.first_name,
                'last_name', player.last_name,
                'linked', player.profile_id is not null
              ) order by player.last_name, player.first_name
            ), '[]'::jsonb)
            from public.championship_team_players as team_player
            join public.championship_players as player on player.id = team_player.player_id
            where team_player.team_id = team.id
          )
        ) order by federation_club.name, team.team_number
      ), '[]'::jsonb)
      from public.championship_teams as team
      join public.championship_divisions as division on division.id = team.division_id
      join public.championship_federation_clubs as federation_club
        on federation_club.id = team.federation_club_id
      left join public.championship_pools as pool on pool.id = team.pool_id
      where division.championship_id = championship.id
    ),
    'matches', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', match.id,
          'division_id', match.division_id,
          'division_name', division.name,
          'pool_code', pool.code,
          'phase', match.phase,
          'team1_id', match.team1_id,
          'team1_label', team1.source_label,
          'team2_id', match.team2_id,
          'team2_label', team2.source_label,
          'scheduled_on', match.scheduled_on,
          'scheduled_time', match.scheduled_time,
          'report_on', match.report_on,
          'report_time', match.report_time,
          'venue', match.venue,
          'agreement_on', match.agreement_on,
          'agreement_time', match.agreement_time,
          'agreement_venue', match.agreement_venue,
          'status', match.status,
          'score_team1', match.score_team1,
          'score_team2', match.score_team2,
          'score_raw', match.score_raw,
          'result_comment', match.result_comment
        ) order by
          coalesce(match.report_on, match.agreement_on, match.scheduled_on) nulls last,
          division.display_order,
          match.phase,
          team1.source_label,
          team2.source_label
      ), '[]'::jsonb)
      from public.championship_matches as match
      join public.championship_divisions as division on division.id = match.division_id
      join public.championship_teams as team1 on team1.id = match.team1_id
      join public.championship_teams as team2 on team2.id = match.team2_id
      left join public.championship_pools as pool on pool.id = match.pool_id
      where division.championship_id = championship.id
    )
  ) into result
  from public.championships as championship
  where championship.id = target_id;

  if result is null then
    raise exception 'Championship not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function public.admin_preview_championship_matches_update(
  target_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  championship_row public.championships%rowtype;
  source_row jsonb;
  division_id uuid;
  team1_id uuid;
  team2_id uuid;
  existing_match public.championship_matches%rowtype;
  occurrence_number integer;
  fields text[];
  changes jsonb := '[]'::jsonb;
  issues jsonb := '[]'::jsonb;
  new_phases text[] := '{}'::text[];
  incoming_count integer := 0;
  unchanged_count integer := 0;
  changed_count integer := 0;
  new_count integer := 0;
  result_added_count integer := 0;
  rescheduled_count integer := 0;
  existing_batch_id uuid;
  file_checksum text := nullif(btrim(payload #>> '{file,checksum}'), '');
  file_name text := nullif(btrim(payload #>> '{file,fileName}'), '');
  phase_key text;
  existing_found boolean;
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select * into championship_row
  from public.championships
  where id = target_id;

  if championship_row.id is null then
    raise exception 'Championship not found' using errcode = 'P0002';
  end if;

  if payload is null
    or jsonb_typeof(payload) <> 'object'
    or jsonb_typeof(payload -> 'matches') <> 'array'
    or jsonb_array_length(payload -> 'matches') = 0
    or file_checksum is null
    or file_name is null
  then
    raise exception 'Championship matches update payload is invalid' using errcode = '22023';
  end if;

  if public.championship_import_normalize(payload ->> 'competition') <>
      public.championship_import_normalize(championship_row.name)
    or public.championship_import_normalize(payload ->> 'specialty') <>
      public.championship_import_normalize(championship_row.specialty)
  then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'competition_mismatch',
      'message', 'Le fichier ne correspond pas à ce championnat.'
    ));
  end if;

  select batch.id into existing_batch_id
  from public.championship_import_files as imported_file
  join public.championship_import_batches as batch on batch.id = imported_file.batch_id
  where batch.championship_id = target_id
    and batch.club_id = target_club_id
    and batch.status = 'applied'
    and imported_file.checksum = file_checksum
  order by batch.applied_at desc
  limit 1;

  if existing_batch_id is not null then
    return jsonb_build_object(
      'valid', jsonb_array_length(issues) = 0,
      'alreadyImported', true,
      'batchId', existing_batch_id,
      'summary', jsonb_build_object(
        'incomingCount', jsonb_array_length(payload -> 'matches'),
        'unchangedCount', jsonb_array_length(payload -> 'matches'),
        'changedCount', 0,
        'newCount', 0,
        'resultAddedCount', 0,
        'rescheduledCount', 0,
        'newPhaseCount', 0
      ),
      'changes', '[]'::jsonb,
      'issues', issues
    );
  end if;

  for source_row in select * from jsonb_array_elements(payload -> 'matches')
  loop
    incoming_count := incoming_count + 1;
    occurrence_number := greatest(coalesce((source_row ->> 'occurrence')::integer, 1), 1);

    select division.id into division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = public.championship_import_normalize(source_row ->> 'category');

    if division_id is null then
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'unknown_division',
        'message', 'Série inconnue : ' || coalesce(source_row ->> 'category', '')
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
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'unknown_team',
        'message', 'Une équipe du fichier n’existe pas dans les engagements importés.',
        'category', source_row ->> 'category',
        'phase', source_row ->> 'phase',
        'team1', source_row #>> '{team1,clubName}',
        'team2', source_row #>> '{team2,clubName}'
      ));
      continue;
    end if;

    select match.* into existing_match
    from public.championship_matches as match
    join (
      select ranked_match.id,
        row_number() over (
          order by
            coalesce(ranked_match.scheduled_on, ranked_match.report_on, ranked_match.agreement_on) nulls last,
            ranked_match.source_key,
            ranked_match.id
        ) as occurrence
      from public.championship_matches as ranked_match
      where ranked_match.division_id = division_id
        and public.championship_import_normalize(ranked_match.phase) =
          public.championship_import_normalize(source_row ->> 'phase')
        and ranked_match.team1_id = team1_id
        and ranked_match.team2_id = team2_id
    ) as ranked on ranked.id = match.id
    where ranked.occurrence = occurrence_number
    limit 1;
    existing_found := found;

    if not existing_found then
      new_count := new_count + 1;
      phase_key := public.championship_import_normalize(source_row ->> 'category') || '|' ||
        public.championship_import_normalize(source_row ->> 'phase');
      if not (phase_key = any(new_phases))
        and not exists (
          select 1
          from public.championship_matches as known_match
          where known_match.division_id = division_id
            and public.championship_import_normalize(known_match.phase) =
              public.championship_import_normalize(source_row ->> 'phase')
        )
      then
        new_phases := array_append(new_phases, phase_key);
      end if;
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'new',
        'category', source_row ->> 'category',
        'phase', source_row ->> 'phase',
        'team1', source_row #>> '{team1,clubName}',
        'team1Number', source_row #>> '{team1,teamNumber}',
        'team2', source_row #>> '{team2,clubName}',
        'team2Number', source_row #>> '{team2,teamNumber}',
        'score', source_row ->> 'scoreRaw',
        'scheduledOn', source_row ->> 'scheduledOn',
        'fields', jsonb_build_array('nouvelle rencontre')
      ));
      continue;
    end if;

    fields := '{}'::text[];
    if existing_match.scheduled_on is distinct from nullif(source_row ->> 'scheduledOn', '')::date
      or existing_match.scheduled_time is distinct from nullif(source_row ->> 'scheduledTime', '')::time
    then
      fields := array_append(fields, 'date/heure');
    end if;
    if existing_match.report_on is distinct from nullif(source_row ->> 'reportOn', '')::date
      or existing_match.report_time is distinct from nullif(source_row ->> 'reportTime', '')::time
    then
      fields := array_append(fields, 'report');
    end if;
    if existing_match.venue is distinct from nullif(btrim(source_row ->> 'venue'), '')
      or existing_match.agreement_venue is distinct from nullif(btrim(source_row ->> 'agreementVenue'), '')
    then
      fields := array_append(fields, 'lieu');
    end if;
    if existing_match.status::text is distinct from btrim(source_row ->> 'status')
    then
      fields := array_append(fields, 'statut');
    end if;
    if existing_match.score_raw is distinct from nullif(btrim(source_row ->> 'scoreRaw'), '')
      or existing_match.score_team1 is distinct from nullif(source_row ->> 'scoreTeam1', '')::integer
      or existing_match.score_team2 is distinct from nullif(source_row ->> 'scoreTeam2', '')::integer
    then
      fields := array_append(fields, 'résultat');
    end if;
    if existing_match.result_comment is distinct from nullif(btrim(source_row ->> 'resultComment'), '')
    then
      fields := array_append(fields, 'commentaire');
    end if;

    if cardinality(fields) = 0 then
      unchanged_count := unchanged_count + 1;
    else
      changed_count := changed_count + 1;
      if existing_match.score_raw is null and nullif(btrim(source_row ->> 'scoreRaw'), '') is not null then
        result_added_count := result_added_count + 1;
      end if;
      if 'date/heure' = any(fields) or 'report' = any(fields) then
        rescheduled_count := rescheduled_count + 1;
      end if;
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'changed',
        'category', source_row ->> 'category',
        'phase', source_row ->> 'phase',
        'team1', source_row #>> '{team1,clubName}',
        'team1Number', source_row #>> '{team1,teamNumber}',
        'team2', source_row #>> '{team2,clubName}',
        'team2Number', source_row #>> '{team2,teamNumber}',
        'score', source_row ->> 'scoreRaw',
        'scheduledOn', source_row ->> 'scheduledOn',
        'fields', to_jsonb(fields)
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'valid', jsonb_array_length(issues) = 0,
    'alreadyImported', false,
    'batchId', null,
    'summary', jsonb_build_object(
      'incomingCount', incoming_count,
      'unchangedCount', unchanged_count,
      'changedCount', changed_count,
      'newCount', new_count,
      'resultAddedCount', result_added_count,
      'rescheduledCount', rescheduled_count,
      'newPhaseCount', cardinality(new_phases)
    ),
    'changes', changes,
    'issues', issues
  );
end;
$$;

create or replace function public.admin_apply_championship_matches_update(
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
  preview jsonb;
  source_row jsonb;
  division_id uuid;
  team1_id uuid;
  team2_id uuid;
  team1_pool_id uuid;
  team2_pool_id uuid;
  match_pool_id uuid;
  existing_match public.championship_matches%rowtype;
  existing_found boolean;
  occurrence_number integer;
  batch_id uuid;
  prior_batch_id uuid;
  import_file_id uuid;
  file_checksum text := nullif(btrim(payload #>> '{file,checksum}'), '');
  summary jsonb;
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  preview := public.admin_preview_championship_matches_update(target_id, payload);
  if coalesce((preview ->> 'valid')::boolean, false) is false then
    raise exception 'Championship matches update is invalid' using errcode = '22023';
  end if;

  if coalesce((preview ->> 'alreadyImported')::boolean, false) then
    prior_batch_id := nullif(preview ->> 'batchId', '')::uuid;
    return jsonb_build_object(
      'championshipId', target_id,
      'batchId', prior_batch_id,
      'alreadyImported', true,
      'summary', preview -> 'summary'
    );
  end if;

  insert into public.championship_import_batches (
    championship_id,
    club_id,
    status,
    source_url,
    summary,
    created_by
  )
  select
    target_id,
    target_club_id,
    'preview',
    championship.source_url,
    preview -> 'summary',
    actor_id
  from public.championships as championship
  where championship.id = target_id
  returning id into batch_id;

  insert into public.championship_import_files (
    batch_id,
    kind,
    file_name,
    checksum,
    row_count,
    metadata
  )
  values (
    batch_id,
    'matches',
    btrim(payload #>> '{file,fileName}'),
    file_checksum,
    greatest(coalesce((payload #>> '{file,rowCount}')::integer, 0), 0),
    jsonb_build_object('mode', 'incremental_update')
  )
  returning id into import_file_id;

  for source_row in select * from jsonb_array_elements(payload -> 'matches')
  loop
    occurrence_number := greatest(coalesce((source_row ->> 'occurrence')::integer, 1), 1);

    select division.id into division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = public.championship_import_normalize(source_row ->> 'category');

    select team.id, team.pool_id into team1_id, team1_pool_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = division_id
      and federation_club.normalized_name = public.championship_import_normalize(source_row #>> '{team1,clubName}')
      and team.team_number = btrim(source_row #>> '{team1,teamNumber}')
    limit 1;

    select team.id, team.pool_id into team2_id, team2_pool_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = division_id
      and federation_club.normalized_name = public.championship_import_normalize(source_row #>> '{team2,clubName}')
      and team.team_number = btrim(source_row #>> '{team2,teamNumber}')
    limit 1;

    select match.* into existing_match
    from public.championship_matches as match
    join (
      select ranked_match.id,
        row_number() over (
          order by
            coalesce(ranked_match.scheduled_on, ranked_match.report_on, ranked_match.agreement_on) nulls last,
            ranked_match.source_key,
            ranked_match.id
        ) as occurrence
      from public.championship_matches as ranked_match
      where ranked_match.division_id = division_id
        and public.championship_import_normalize(ranked_match.phase) =
          public.championship_import_normalize(source_row ->> 'phase')
        and ranked_match.team1_id = team1_id
        and ranked_match.team2_id = team2_id
    ) as ranked on ranked.id = match.id
    where ranked.occurrence = occurrence_number
    limit 1;
    existing_found := found;

    match_pool_id := case
      when team1_pool_id is not null and team1_pool_id = team2_pool_id then team1_pool_id
      else null
    end;

    if existing_found then
      update public.championship_matches as match
      set pool_id = coalesce(match_pool_id, match.pool_id),
          scheduled_on = nullif(source_row ->> 'scheduledOn', '')::date,
          scheduled_time = nullif(source_row ->> 'scheduledTime', '')::time,
          report_on = nullif(source_row ->> 'reportOn', '')::date,
          report_time = nullif(source_row ->> 'reportTime', '')::time,
          venue = nullif(btrim(source_row ->> 'venue'), ''),
          agreement_on = nullif(source_row ->> 'agreementOn', '')::date,
          agreement_time = nullif(source_row ->> 'agreementTime', '')::time,
          agreement_venue = nullif(btrim(source_row ->> 'agreementVenue'), ''),
          status = btrim(source_row ->> 'status')::public.championship_match_status,
          score_team1 = nullif(source_row ->> 'scoreTeam1', '')::integer,
          score_team2 = nullif(source_row ->> 'scoreTeam2', '')::integer,
          score_raw = nullif(btrim(source_row ->> 'scoreRaw'), ''),
          result_comment = nullif(btrim(source_row ->> 'resultComment'), ''),
          source_metadata = coalesce(source_row -> 'sourceMetadata', '{}'::jsonb),
          source_import_file_id = import_file_id,
          updated_at = now()
      where match.id = existing_match.id;
    else
      insert into public.championship_matches (
        division_id,
        pool_id,
        phase,
        source_key,
        team1_id,
        team2_id,
        scheduled_on,
        scheduled_time,
        report_on,
        report_time,
        venue,
        agreement_on,
        agreement_time,
        agreement_venue,
        status,
        score_team1,
        score_team2,
        score_raw,
        result_comment,
        source_metadata,
        source_import_file_id
      )
      values (
        division_id,
        match_pool_id,
        btrim(source_row ->> 'phase'),
        btrim(source_row ->> 'sourceKey'),
        team1_id,
        team2_id,
        nullif(source_row ->> 'scheduledOn', '')::date,
        nullif(source_row ->> 'scheduledTime', '')::time,
        nullif(source_row ->> 'reportOn', '')::date,
        nullif(source_row ->> 'reportTime', '')::time,
        nullif(btrim(source_row ->> 'venue'), ''),
        nullif(source_row ->> 'agreementOn', '')::date,
        nullif(source_row ->> 'agreementTime', '')::time,
        nullif(btrim(source_row ->> 'agreementVenue'), ''),
        btrim(source_row ->> 'status')::public.championship_match_status,
        nullif(source_row ->> 'scoreTeam1', '')::integer,
        nullif(source_row ->> 'scoreTeam2', '')::integer,
        nullif(btrim(source_row ->> 'scoreRaw'), ''),
        nullif(btrim(source_row ->> 'resultComment'), ''),
        coalesce(source_row -> 'sourceMetadata', '{}'::jsonb),
        import_file_id
      );
    end if;
  end loop;

  summary := preview -> 'summary';
  update public.championship_import_batches as batch
  set status = 'applied',
      summary = summary,
      applied_at = now()
  where batch.id = batch_id;

  update public.championships
  set updated_by = actor_id,
      updated_at = now()
  where id = target_id;

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
    'matches_update.applied',
    jsonb_build_object(
      'batchId', batch_id,
      'checksum', file_checksum,
      'summary', summary
    )
  );

  return jsonb_build_object(
    'championshipId', target_id,
    'batchId', batch_id,
    'alreadyImported', false,
    'summary', summary
  );
end;
$$;

revoke all on function public.admin_get_championship_detail(uuid) from public, anon, authenticated;
revoke all on function public.admin_preview_championship_matches_update(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_apply_championship_matches_update(uuid, jsonb) from public, anon, authenticated;

grant execute on function public.admin_get_championship_detail(uuid) to authenticated;
grant execute on function public.admin_preview_championship_matches_update(uuid, jsonb) to authenticated;
grant execute on function public.admin_apply_championship_matches_update(uuid, jsonb) to authenticated;