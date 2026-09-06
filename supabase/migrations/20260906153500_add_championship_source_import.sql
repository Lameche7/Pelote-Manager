create or replace function public.championship_import_normalize(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      lower(
        translate(
          coalesce(value, ''),
          'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝŸýÿŒœ',
          'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYYyyOo'
        )
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.admin_import_championship_sources(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_club_id uuid := public.admin_current_club_id();
  v_actor_id uuid := auth.uid();
  v_championship_payload jsonb := payload -> 'championship';
  v_championship_id uuid;
  v_existing_batch_id uuid;
  v_existing_summary jsonb;
  v_batch_id uuid;
  v_matches_file_id uuid;
  v_imported_file_id uuid;
  v_source_provider text := coalesce(
    nullif(btrim(v_championship_payload ->> 'sourceProvider'), ''),
    'ffpb'
  );
  v_source_external_id text := nullif(
    btrim(v_championship_payload ->> 'sourceExternalId'),
    ''
  );
  v_source_url text := nullif(btrim(v_championship_payload ->> 'sourceUrl'), '');
  v_championship_name text := btrim(v_championship_payload ->> 'name');
  v_specialty text := btrim(v_championship_payload ->> 'specialty');
  v_season_label text := coalesce(
    btrim(v_championship_payload ->> 'seasonLabel'),
    ''
  );
  v_local_federation_club_name text := btrim(payload ->> 'localFederationClubName');
  v_local_federation_club_normalized text;
  v_federation_club_id uuid;
  v_division_id uuid;
  v_pool_id uuid;
  v_team_id uuid;
  v_team1_id uuid;
  v_team2_id uuid;
  v_team1_pool_id uuid;
  v_team2_pool_id uuid;
  v_player_id uuid;
  v_candidate_profile_id uuid;
  v_source_row jsonb;
  v_player_row jsonb;
  v_file_row jsonb;
  v_current_name text;
  v_normalized_name text;
  v_normalized_first_name text;
  v_normalized_last_name text;
  v_licence_number text;
  v_category text;
  v_pool_code text;
  v_status_text text;
  v_division_order integer := 0;
  v_summary jsonb;
begin
  if not public.has_club_permission(v_target_club_id, 'championships.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if payload is null
    or jsonb_typeof(payload) <> 'object'
    or v_championship_payload is null
    or jsonb_typeof(v_championship_payload) <> 'object'
    or v_championship_name = ''
    or v_specialty = ''
    or v_local_federation_club_name = ''
    or jsonb_typeof(payload -> 'engagements') <> 'array'
    or jsonb_array_length(payload -> 'engagements') = 0
    or jsonb_typeof(payload -> 'matches') <> 'array'
    or jsonb_array_length(payload -> 'matches') = 0
    or jsonb_typeof(payload -> 'files') <> 'array'
    or jsonb_array_length(payload -> 'files') < 2
  then
    raise exception 'Championship import payload is invalid' using errcode = '22023';
  end if;

  v_local_federation_club_normalized := public.championship_import_normalize(
    v_local_federation_club_name
  );

  if not exists (
    select 1
    from jsonb_array_elements(payload -> 'engagements') as engagement
    where public.championship_import_normalize(engagement ->> 'clubName') =
      v_local_federation_club_normalized
  ) then
    raise exception 'Championship federation club mapping is invalid'
      using errcode = '22023';
  end if;

  if v_source_external_id is not null then
    select championship.id
    into v_championship_id
    from public.championships as championship
    where championship.source_provider = v_source_provider
      and championship.source_external_id = v_source_external_id;
  end if;

  if v_championship_id is not null
    and exists (
      select 1
      from public.championship_club_links as link
      where link.championship_id = v_championship_id
        and link.access_role = 'manager'
        and link.club_id <> v_target_club_id
    )
  then
    raise exception 'Championship source is already managed by another club'
      using errcode = '42501';
  end if;

  if v_championship_id is null then
    insert into public.championships (
      name,
      specialty,
      season_label,
      source_provider,
      source_external_id,
      source_url,
      status,
      created_by_club_id,
      created_by,
      updated_by
    )
    values (
      v_championship_name,
      v_specialty,
      v_season_label,
      v_source_provider,
      v_source_external_id,
      v_source_url,
      'active',
      v_target_club_id,
      v_actor_id,
      v_actor_id
    )
    returning id into v_championship_id;
  else
    update public.championships as championship
    set name = v_championship_name,
        specialty = v_specialty,
        season_label = v_season_label,
        source_url = coalesce(v_source_url, championship.source_url),
        updated_by = v_actor_id,
        updated_at = now()
    where championship.id = v_championship_id;
  end if;

  select batch.id, batch.summary
  into v_existing_batch_id, v_existing_summary
  from public.championship_import_batches as batch
  where batch.championship_id = v_championship_id
    and batch.club_id = v_target_club_id
    and batch.status = 'applied'
    and (
      select count(*)
      from public.championship_import_files as imported_file
      where imported_file.batch_id = batch.id
    ) = jsonb_array_length(payload -> 'files')
    and not exists (
      select 1
      from jsonb_array_elements(payload -> 'files') as requested_file
      where not exists (
        select 1
        from public.championship_import_files as imported_file
        where imported_file.batch_id = batch.id
          and imported_file.checksum = requested_file ->> 'checksum'
      )
    )
  order by batch.created_at desc
  limit 1;

  if v_existing_batch_id is not null then
    return jsonb_build_object(
      'championshipId', v_championship_id,
      'batchId', v_existing_batch_id,
      'alreadyImported', true,
      'summary', v_existing_summary
    );
  end if;

  for v_source_row in
    select distinct on (
      public.championship_import_normalize(engagement ->> 'clubName')
    ) engagement
    from jsonb_array_elements(payload -> 'engagements') as engagement
    where nullif(btrim(engagement ->> 'clubName'), '') is not null
    order by public.championship_import_normalize(engagement ->> 'clubName')
  loop
    v_current_name := btrim(v_source_row ->> 'clubName');
    v_normalized_name := public.championship_import_normalize(v_current_name);

    insert into public.championship_federation_clubs (
      source_provider,
      name,
      normalized_name
    )
    values (v_source_provider, v_current_name, v_normalized_name)
    on conflict (source_provider, normalized_name)
    do update set
      name = excluded.name,
      updated_at = now();
  end loop;

  select federation_club.id
  into v_federation_club_id
  from public.championship_federation_clubs as federation_club
  where federation_club.source_provider = v_source_provider
    and federation_club.normalized_name = v_local_federation_club_normalized;

  if v_federation_club_id is null
    or exists (
      select 1
      from public.championship_federation_clubs as federation_club
      where federation_club.id = v_federation_club_id
        and federation_club.linked_club_id is not null
        and federation_club.linked_club_id <> v_target_club_id
    )
    or exists (
      select 1
      from public.championship_federation_clubs as federation_club
      where federation_club.source_provider = v_source_provider
        and federation_club.linked_club_id = v_target_club_id
        and federation_club.id <> v_federation_club_id
    )
  then
    raise exception 'Championship federation club mapping is invalid'
      using errcode = '23505';
  end if;

  update public.championship_federation_clubs as federation_club
  set linked_club_id = v_target_club_id,
      updated_at = now()
  where federation_club.id = v_federation_club_id;

  insert into public.championship_club_links (
    championship_id,
    federation_club_id,
    club_id,
    access_role,
    created_by
  )
  values (
    v_championship_id,
    v_federation_club_id,
    v_target_club_id,
    'manager',
    v_actor_id
  )
  on conflict (championship_id, club_id)
  do update set
    federation_club_id = excluded.federation_club_id,
    access_role = 'manager';

  insert into public.championship_import_batches (
    championship_id,
    club_id,
    status,
    source_url,
    summary,
    created_by
  )
  values (
    v_championship_id,
    v_target_club_id,
    'preview',
    v_source_url,
    '{}'::jsonb,
    v_actor_id
  )
  returning id into v_batch_id;

  for v_file_row in
    select * from jsonb_array_elements(payload -> 'files')
  loop
    if v_file_row ->> 'kind' not in ('matches', 'engagements')
      or nullif(btrim(v_file_row ->> 'fileName'), '') is null
      or nullif(btrim(v_file_row ->> 'checksum'), '') is null
    then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;

    insert into public.championship_import_files (
      batch_id,
      kind,
      file_name,
      checksum,
      row_count,
      metadata
    )
    values (
      v_batch_id,
      (v_file_row ->> 'kind')::public.championship_import_kind,
      btrim(v_file_row ->> 'fileName'),
      btrim(v_file_row ->> 'checksum'),
      greatest(coalesce((v_file_row ->> 'rowCount')::integer, 0), 0),
      '{}'::jsonb
    )
    returning id into v_imported_file_id;

    if v_file_row ->> 'kind' = 'matches' then
      v_matches_file_id := v_imported_file_id;
    end if;
  end loop;

  if v_matches_file_id is null then
    raise exception 'Championship import payload is invalid' using errcode = '22023';
  end if;

  for v_source_row in
    select distinct on (
      public.championship_import_normalize(engagement ->> 'category')
    ) engagement
    from jsonb_array_elements(payload -> 'engagements') as engagement
    order by public.championship_import_normalize(engagement ->> 'category')
  loop
    v_category := btrim(v_source_row ->> 'category');
    v_normalized_name := public.championship_import_normalize(v_category);

    if v_category = '' or v_normalized_name = '' then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;

    v_division_order := v_division_order + 1;
    insert into public.championship_divisions (
      championship_id,
      name,
      normalized_name,
      display_order
    )
    values (
      v_championship_id,
      v_category,
      v_normalized_name,
      v_division_order
    )
    on conflict (championship_id, normalized_name)
    do update set
      name = excluded.name,
      display_order = excluded.display_order,
      updated_at = now();
  end loop;

  for v_source_row in
    select distinct on (
      public.championship_import_normalize(engagement ->> 'category'),
      btrim(engagement ->> 'poolCode')
    ) engagement
    from jsonb_array_elements(payload -> 'engagements') as engagement
    where nullif(btrim(engagement ->> 'poolCode'), '') is not null
    order by
      public.championship_import_normalize(engagement ->> 'category'),
      btrim(engagement ->> 'poolCode')
  loop
    v_category := public.championship_import_normalize(v_source_row ->> 'category');
    v_pool_code := btrim(v_source_row ->> 'poolCode');

    select division.id
    into v_division_id
    from public.championship_divisions as division
    where division.championship_id = v_championship_id
      and division.normalized_name = v_category;

    if v_division_id is null then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;

    insert into public.championship_pools (
      division_id,
      code,
      name,
      display_order
    )
    values (
      v_division_id,
      v_pool_code,
      'Poule ' || v_pool_code,
      0
    )
    on conflict (division_id, code)
    do update set name = excluded.name;
  end loop;

  for v_source_row in
    select * from jsonb_array_elements(payload -> 'engagements')
  loop
    v_category := public.championship_import_normalize(v_source_row ->> 'category');
    v_current_name := btrim(v_source_row ->> 'clubName');
    v_normalized_name := public.championship_import_normalize(v_current_name);
    v_pool_code := nullif(btrim(v_source_row ->> 'poolCode'), '');

    select division.id
    into v_division_id
    from public.championship_divisions as division
    where division.championship_id = v_championship_id
      and division.normalized_name = v_category;

    select federation_club.id
    into v_federation_club_id
    from public.championship_federation_clubs as federation_club
    where federation_club.source_provider = v_source_provider
      and federation_club.normalized_name = v_normalized_name;

    v_pool_id := null;
    if v_pool_code is not null then
      select pool.id
      into v_pool_id
      from public.championship_pools as pool
      where pool.division_id = v_division_id
        and pool.code = v_pool_code;
    end if;

    if v_division_id is null
      or v_federation_club_id is null
      or nullif(btrim(v_source_row ->> 'teamNumber'), '') is null
      or nullif(btrim(v_source_row ->> 'teamLabel'), '') is null
      or (v_pool_code is not null and v_pool_id is null)
    then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;

    insert into public.championship_teams (
      division_id,
      federation_club_id,
      pool_id,
      team_number,
      source_label,
      source_rank
    )
    values (
      v_division_id,
      v_federation_club_id,
      v_pool_id,
      btrim(v_source_row ->> 'teamNumber'),
      btrim(v_source_row ->> 'teamLabel'),
      nullif(v_source_row ->> 'sourceRank', '')::integer
    )
    on conflict (division_id, federation_club_id, team_number)
    do update set
      pool_id = excluded.pool_id,
      source_label = excluded.source_label,
      source_rank = excluded.source_rank,
      updated_at = now()
    returning id into v_team_id;

    if jsonb_typeof(v_source_row -> 'players') <> 'array'
      or jsonb_array_length(v_source_row -> 'players') = 0
    then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;

    for v_player_row in
      select * from jsonb_array_elements(v_source_row -> 'players')
    loop
      v_licence_number := regexp_replace(
        coalesce(v_player_row ->> 'licenceNumber', ''),
        '[^0-9]+',
        '',
        'g'
      );
      v_normalized_first_name := public.championship_import_normalize(
        v_player_row ->> 'firstName'
      );
      v_normalized_last_name := public.championship_import_normalize(
        v_player_row ->> 'lastName'
      );

      if v_licence_number = ''
        or v_normalized_first_name = ''
        or v_normalized_last_name = ''
      then
        raise exception 'Championship import payload is invalid' using errcode = '22023';
      end if;

      select player.id
      into v_player_id
      from public.championship_players as player
      where player.source_provider = v_source_provider
        and player.licence_number = v_licence_number;

      if v_player_id is not null
        and exists (
          select 1
          from public.championship_players as player
          where player.id = v_player_id
            and (
              player.normalized_first_name <> v_normalized_first_name
              or player.normalized_last_name <> v_normalized_last_name
            )
        )
      then
        raise exception 'Championship player identity conflict' using errcode = '23505';
      end if;

      v_candidate_profile_id := null;
      select profile.id
      into v_candidate_profile_id
      from public.club_members as member
      join public.profiles as profile
        on profile.member_id = member.id
      where regexp_replace(
          member.licence_number_normalized,
          '[^0-9]+',
          '',
          'g'
        ) = v_licence_number
        and public.championship_import_normalize(member.first_name) =
          v_normalized_first_name
        and public.championship_import_normalize(member.last_name) =
          v_normalized_last_name
      limit 1;

      insert into public.championship_players (
        source_provider,
        licence_number,
        first_name,
        last_name,
        normalized_first_name,
        normalized_last_name,
        profile_id,
        link_status,
        linked_at
      )
      values (
        v_source_provider,
        v_licence_number,
        btrim(v_player_row ->> 'firstName'),
        btrim(v_player_row ->> 'lastName'),
        v_normalized_first_name,
        v_normalized_last_name,
        v_candidate_profile_id,
        case
          when v_candidate_profile_id is null then 'unlinked'
          else 'verified'
        end,
        case
          when v_candidate_profile_id is null then null
          else now()
        end
      )
      on conflict (source_provider, licence_number)
      do update set
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        profile_id = coalesce(championship_players.profile_id, excluded.profile_id),
        link_status = case
          when championship_players.profile_id is not null
            then championship_players.link_status
          when excluded.profile_id is not null
            then 'verified'::public.championship_player_link_status
          else championship_players.link_status
        end,
        linked_at = case
          when championship_players.profile_id is not null
            then championship_players.linked_at
          when excluded.profile_id is not null
            then now()
          else championship_players.linked_at
        end,
        updated_at = now()
      returning id into v_player_id;

      insert into public.championship_team_players (
        team_id,
        player_id,
        source_entry,
        source_flags
      )
      values (
        v_team_id,
        v_player_id,
        coalesce(v_player_row ->> 'sourceEntry', ''),
        case
          when jsonb_typeof(v_player_row -> 'sourceFlags') = 'array'
            then array(
              select jsonb_array_elements_text(v_player_row -> 'sourceFlags')
            )
          else '{}'::text[]
        end
      )
      on conflict (team_id, player_id)
      do update set
        source_entry = excluded.source_entry,
        source_flags = excluded.source_flags;
    end loop;
  end loop;

  for v_source_row in
    select * from jsonb_array_elements(payload -> 'matches')
  loop
    v_category := public.championship_import_normalize(v_source_row ->> 'category');
    v_status_text := btrim(v_source_row ->> 'status');

    if v_status_text not in (
      'to_schedule',
      'scheduled',
      'postponed',
      'played',
      'forfeit',
      'cancelled'
    )
      or nullif(btrim(v_source_row ->> 'phase'), '') is null
      or nullif(btrim(v_source_row ->> 'sourceKey'), '') is null
    then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;

    select division.id
    into v_division_id
    from public.championship_divisions as division
    where division.championship_id = v_championship_id
      and division.normalized_name = v_category;

    v_team1_id := null;
    v_team1_pool_id := null;
    select team.id, team.pool_id
    into v_team1_id, v_team1_pool_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = v_division_id
      and federation_club.source_provider = v_source_provider
      and federation_club.normalized_name = public.championship_import_normalize(
        v_source_row #>> '{team1,clubName}'
      )
      and team.team_number = btrim(v_source_row #>> '{team1,teamNumber}');

    v_team2_id := null;
    v_team2_pool_id := null;
    select team.id, team.pool_id
    into v_team2_id, v_team2_pool_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = v_division_id
      and federation_club.source_provider = v_source_provider
      and federation_club.normalized_name = public.championship_import_normalize(
        v_source_row #>> '{team2,clubName}'
      )
      and team.team_number = btrim(v_source_row #>> '{team2,teamNumber}');

    if v_division_id is null or v_team1_id is null or v_team2_id is null then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;

    v_pool_id := case
      when v_team1_pool_id is not null and v_team1_pool_id = v_team2_pool_id
        then v_team1_pool_id
      else null
    end;

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
      v_division_id,
      v_pool_id,
      btrim(v_source_row ->> 'phase'),
      btrim(v_source_row ->> 'sourceKey'),
      v_team1_id,
      v_team2_id,
      nullif(v_source_row ->> 'scheduledOn', '')::date,
      nullif(v_source_row ->> 'scheduledTime', '')::time,
      nullif(v_source_row ->> 'reportOn', '')::date,
      nullif(v_source_row ->> 'reportTime', '')::time,
      nullif(btrim(v_source_row ->> 'venue'), ''),
      nullif(v_source_row ->> 'agreementOn', '')::date,
      nullif(v_source_row ->> 'agreementTime', '')::time,
      nullif(btrim(v_source_row ->> 'agreementVenue'), ''),
      v_status_text::public.championship_match_status,
      nullif(v_source_row ->> 'scoreTeam1', '')::integer,
      nullif(v_source_row ->> 'scoreTeam2', '')::integer,
      nullif(btrim(v_source_row ->> 'scoreRaw'), ''),
      nullif(btrim(v_source_row ->> 'resultComment'), ''),
      coalesce(v_source_row -> 'sourceMetadata', '{}'::jsonb),
      v_matches_file_id
    )
    on conflict (division_id, source_key)
    do update set
      pool_id = excluded.pool_id,
      phase = excluded.phase,
      team1_id = excluded.team1_id,
      team2_id = excluded.team2_id,
      scheduled_on = excluded.scheduled_on,
      scheduled_time = excluded.scheduled_time,
      report_on = excluded.report_on,
      report_time = excluded.report_time,
      venue = excluded.venue,
      agreement_on = excluded.agreement_on,
      agreement_time = excluded.agreement_time,
      agreement_venue = excluded.agreement_venue,
      status = excluded.status,
      score_team1 = excluded.score_team1,
      score_team2 = excluded.score_team2,
      score_raw = excluded.score_raw,
      result_comment = excluded.result_comment,
      source_metadata = excluded.source_metadata,
      source_import_file_id = excluded.source_import_file_id,
      updated_at = now();
  end loop;

  select jsonb_build_object(
    'divisionCount', (
      select count(*)
      from public.championship_divisions as division
      where division.championship_id = v_championship_id
    ),
    'poolCount', (
      select count(*)
      from public.championship_pools as pool
      join public.championship_divisions as division
        on division.id = pool.division_id
      where division.championship_id = v_championship_id
    ),
    'clubCount', (
      select count(distinct team.federation_club_id)
      from public.championship_teams as team
      join public.championship_divisions as division
        on division.id = team.division_id
      where division.championship_id = v_championship_id
    ),
    'teamCount', (
      select count(*)
      from public.championship_teams as team
      join public.championship_divisions as division
        on division.id = team.division_id
      where division.championship_id = v_championship_id
    ),
    'playerCount', (
      select count(distinct team_player.player_id)
      from public.championship_team_players as team_player
      join public.championship_teams as team
        on team.id = team_player.team_id
      join public.championship_divisions as division
        on division.id = team.division_id
      where division.championship_id = v_championship_id
    ),
    'matchCount', (
      select count(*)
      from public.championship_matches as match
      join public.championship_divisions as division
        on division.id = match.division_id
      where division.championship_id = v_championship_id
    ),
    'linkedPlayerCount', (
      select count(distinct player.id)
      from public.championship_players as player
      join public.championship_team_players as team_player
        on team_player.player_id = player.id
      join public.championship_teams as team
        on team.id = team_player.team_id
      join public.championship_divisions as division
        on division.id = team.division_id
      where division.championship_id = v_championship_id
        and player.profile_id is not null
    )
  ) into v_summary;

  update public.championship_import_batches as batch
  set status = 'applied',
      summary = v_summary,
      applied_at = now()
  where batch.id = v_batch_id;

  update public.championships as championship
  set updated_by = v_actor_id,
      updated_at = now()
  where championship.id = v_championship_id;

  insert into public.championship_audit_log (
    championship_id,
    club_id,
    actor_id,
    action,
    payload
  )
  values (
    v_championship_id,
    v_target_club_id,
    v_actor_id,
    'source_import.applied',
    jsonb_build_object(
      'batchId', v_batch_id,
      'sourceExternalId', v_source_external_id,
      'summary', v_summary
    )
  );

  return jsonb_build_object(
    'championshipId', v_championship_id,
    'batchId', v_batch_id,
    'alreadyImported', false,
    'summary', v_summary
  );
end;
$$;

revoke all on function public.championship_import_normalize(text)
from public, anon, authenticated;
revoke all on function public.admin_import_championship_sources(jsonb)
from public, anon, authenticated;
grant execute on function public.admin_import_championship_sources(jsonb)
to authenticated;
