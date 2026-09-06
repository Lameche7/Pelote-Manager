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
  target_club_id uuid := public.admin_current_club_id();
  actor_id uuid := auth.uid();
  championship_payload jsonb := payload -> 'championship';
  championship_id uuid;
  existing_batch_id uuid;
  existing_summary jsonb;
  batch_id uuid;
  matches_file_id uuid;
  source_provider text := coalesce(nullif(btrim(championship_payload ->> 'sourceProvider'), ''), 'ffpb');
  source_external_id text := nullif(btrim(championship_payload ->> 'sourceExternalId'), '');
  source_url text := nullif(btrim(championship_payload ->> 'sourceUrl'), '');
  championship_name text := btrim(championship_payload ->> 'name');
  specialty text := btrim(championship_payload ->> 'specialty');
  season_label text := coalesce(btrim(championship_payload ->> 'seasonLabel'), '');
  local_federation_club_name text := btrim(payload ->> 'localFederationClubName');
  local_federation_club_normalized text;
  federation_club_id uuid;
  division_id uuid;
  pool_id uuid;
  team_id uuid;
  team1_id uuid;
  team2_id uuid;
  team1_pool_id uuid;
  team2_pool_id uuid;
  player_id uuid;
  candidate_profile_id uuid;
  source_row jsonb;
  player_row jsonb;
  file_row jsonb;
  current_name text;
  normalized_name text;
  normalized_first_name text;
  normalized_last_name text;
  licence_number text;
  category text;
  pool_code text;
  status_text text;
  division_order integer := 0;
  summary jsonb;
begin
  if not public.has_club_permission(target_club_id, 'championships.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if payload is null
    or jsonb_typeof(payload) <> 'object'
    or championship_payload is null
    or jsonb_typeof(championship_payload) <> 'object'
    or championship_name = ''
    or specialty = ''
    or local_federation_club_name = ''
    or jsonb_typeof(payload -> 'engagements') <> 'array'
    or jsonb_array_length(payload -> 'engagements') = 0
    or jsonb_typeof(payload -> 'matches') <> 'array'
    or jsonb_array_length(payload -> 'matches') = 0
    or jsonb_typeof(payload -> 'files') <> 'array'
    or jsonb_array_length(payload -> 'files') < 2
  then
    raise exception 'Championship import payload is invalid' using errcode = '22023';
  end if;

  local_federation_club_normalized := public.championship_import_normalize(local_federation_club_name);

  if not exists (
    select 1
    from jsonb_array_elements(payload -> 'engagements') as engagement
    where public.championship_import_normalize(engagement ->> 'clubName') = local_federation_club_normalized
  ) then
    raise exception 'Championship federation club mapping is invalid' using errcode = '22023';
  end if;

  if source_external_id is not null then
    select championship.id
    into championship_id
    from public.championships as championship
    where championship.source_provider = source_provider
      and championship.source_external_id = source_external_id;
  end if;

  if championship_id is not null
    and exists (
      select 1
      from public.championship_club_links as link
      where link.championship_id = championship_id
        and link.access_role = 'manager'
        and link.club_id <> target_club_id
    )
  then
    raise exception 'Championship source is already managed by another club' using errcode = '42501';
  end if;

  if championship_id is null then
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
      championship_name,
      specialty,
      season_label,
      source_provider,
      source_external_id,
      source_url,
      'active',
      target_club_id,
      actor_id,
      actor_id
    )
    returning id into championship_id;
  else
    update public.championships
    set name = championship_name,
        specialty = specialty,
        season_label = season_label,
        source_url = coalesce(source_url, championships.source_url),
        updated_by = actor_id,
        updated_at = now()
    where id = championship_id;
  end if;

  select batch.id, batch.summary
  into existing_batch_id, existing_summary
  from public.championship_import_batches as batch
  where batch.championship_id = championship_id
    and batch.club_id = target_club_id
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

  if existing_batch_id is not null then
    return jsonb_build_object(
      'championshipId', championship_id,
      'batchId', existing_batch_id,
      'alreadyImported', true,
      'summary', existing_summary
    );
  end if;

  for source_row in
    select distinct on (public.championship_import_normalize(engagement ->> 'clubName')) engagement
    from jsonb_array_elements(payload -> 'engagements') as engagement
    where nullif(btrim(engagement ->> 'clubName'), '') is not null
    order by public.championship_import_normalize(engagement ->> 'clubName')
  loop
    current_name := btrim(source_row ->> 'clubName');
    normalized_name := public.championship_import_normalize(current_name);
    insert into public.championship_federation_clubs (
      source_provider,
      name,
      normalized_name
    )
    values (source_provider, current_name, normalized_name)
    on conflict (source_provider, normalized_name)
    do update set name = excluded.name, updated_at = now();
  end loop;

  select federation_club.id
  into federation_club_id
  from public.championship_federation_clubs as federation_club
  where federation_club.source_provider = source_provider
    and federation_club.normalized_name = local_federation_club_normalized;

  if federation_club_id is null
    or exists (
      select 1
      from public.championship_federation_clubs as federation_club
      where federation_club.id = federation_club_id
        and federation_club.linked_club_id is not null
        and federation_club.linked_club_id <> target_club_id
    )
    or exists (
      select 1
      from public.championship_federation_clubs as federation_club
      where federation_club.source_provider = source_provider
        and federation_club.linked_club_id = target_club_id
        and federation_club.id <> federation_club_id
    )
  then
    raise exception 'Championship federation club mapping is invalid' using errcode = '23505';
  end if;

  update public.championship_federation_clubs
  set linked_club_id = target_club_id,
      updated_at = now()
  where id = federation_club_id;

  insert into public.championship_club_links (
    championship_id,
    federation_club_id,
    club_id,
    access_role,
    created_by
  )
  values (
    championship_id,
    federation_club_id,
    target_club_id,
    'manager',
    actor_id
  )
  on conflict (championship_id, club_id)
  do update set federation_club_id = excluded.federation_club_id,
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
    championship_id,
    target_club_id,
    'preview',
    source_url,
    '{}'::jsonb,
    actor_id
  )
  returning id into batch_id;

  for file_row in select * from jsonb_array_elements(payload -> 'files')
  loop
    if file_row ->> 'kind' not in ('matches', 'engagements')
      or nullif(btrim(file_row ->> 'fileName'), '') is null
      or nullif(btrim(file_row ->> 'checksum'), '') is null
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
      batch_id,
      (file_row ->> 'kind')::public.championship_import_kind,
      btrim(file_row ->> 'fileName'),
      btrim(file_row ->> 'checksum'),
      greatest(coalesce((file_row ->> 'rowCount')::integer, 0), 0),
      '{}'::jsonb
    )
    returning id into team_id;

    if file_row ->> 'kind' = 'matches' then
      matches_file_id := team_id;
    end if;
  end loop;

  for source_row in
    select distinct on (public.championship_import_normalize(engagement ->> 'category')) engagement
    from jsonb_array_elements(payload -> 'engagements') as engagement
    order by public.championship_import_normalize(engagement ->> 'category')
  loop
    category := btrim(source_row ->> 'category');
    normalized_name := public.championship_import_normalize(category);
    if category = '' or normalized_name = '' then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;
    division_order := division_order + 1;
    insert into public.championship_divisions (
      championship_id,
      name,
      normalized_name,
      display_order
    )
    values (championship_id, category, normalized_name, division_order)
    on conflict (championship_id, normalized_name)
    do update set name = excluded.name,
                  display_order = excluded.display_order,
                  updated_at = now();
  end loop;

  for source_row in
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
    category := public.championship_import_normalize(source_row ->> 'category');
    pool_code := btrim(source_row ->> 'poolCode');
    select division.id into division_id
    from public.championship_divisions as division
    where division.championship_id = championship_id
      and division.normalized_name = category;

    insert into public.championship_pools (division_id, code, name, display_order)
    values (division_id, pool_code, 'Poule ' || pool_code, 0)
    on conflict (division_id, code)
    do update set name = excluded.name;
  end loop;

  for source_row in select * from jsonb_array_elements(payload -> 'engagements')
  loop
    category := public.championship_import_normalize(source_row ->> 'category');
    current_name := btrim(source_row ->> 'clubName');
    normalized_name := public.championship_import_normalize(current_name);
    pool_code := nullif(btrim(source_row ->> 'poolCode'), '');

    select division.id into division_id
    from public.championship_divisions as division
    where division.championship_id = championship_id
      and division.normalized_name = category;

    select federation_club.id into federation_club_id
    from public.championship_federation_clubs as federation_club
    where federation_club.source_provider = source_provider
      and federation_club.normalized_name = normalized_name;

    pool_id := null;
    if pool_code is not null then
      select pool.id into pool_id
      from public.championship_pools as pool
      where pool.division_id = division_id
        and pool.code = pool_code;
    end if;

    if division_id is null or federation_club_id is null
      or nullif(btrim(source_row ->> 'teamNumber'), '') is null
      or nullif(btrim(source_row ->> 'teamLabel'), '') is null
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
      division_id,
      federation_club_id,
      pool_id,
      btrim(source_row ->> 'teamNumber'),
      btrim(source_row ->> 'teamLabel'),
      nullif(source_row ->> 'sourceRank', '')::integer
    )
    on conflict (division_id, federation_club_id, team_number)
    do update set pool_id = excluded.pool_id,
                  source_label = excluded.source_label,
                  source_rank = excluded.source_rank,
                  updated_at = now()
    returning id into team_id;

    if jsonb_typeof(source_row -> 'players') <> 'array'
      or jsonb_array_length(source_row -> 'players') = 0
    then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;

    for player_row in select * from jsonb_array_elements(source_row -> 'players')
    loop
      licence_number := regexp_replace(coalesce(player_row ->> 'licenceNumber', ''), '[^0-9]+', '', 'g');
      normalized_first_name := public.championship_import_normalize(player_row ->> 'firstName');
      normalized_last_name := public.championship_import_normalize(player_row ->> 'lastName');
      if licence_number = '' or normalized_first_name = '' or normalized_last_name = '' then
        raise exception 'Championship import payload is invalid' using errcode = '22023';
      end if;

      select player.id
      into player_id
      from public.championship_players as player
      where player.source_provider = source_provider
        and player.licence_number = licence_number;

      if player_id is not null and exists (
        select 1
        from public.championship_players as player
        where player.id = player_id
          and (
            player.normalized_first_name <> normalized_first_name
            or player.normalized_last_name <> normalized_last_name
          )
      ) then
        raise exception 'Championship player identity conflict' using errcode = '23505';
      end if;

      candidate_profile_id := null;
      select profile.id
      into candidate_profile_id
      from public.club_members as member
      join public.profiles as profile on profile.member_id = member.id
      where regexp_replace(member.licence_number_normalized, '[^0-9]+', '', 'g') = licence_number
        and public.championship_import_normalize(member.first_name) = normalized_first_name
        and public.championship_import_normalize(member.last_name) = normalized_last_name
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
        source_provider,
        licence_number,
        btrim(player_row ->> 'firstName'),
        btrim(player_row ->> 'lastName'),
        normalized_first_name,
        normalized_last_name,
        candidate_profile_id,
        case when candidate_profile_id is null then 'unlinked' else 'verified' end,
        case when candidate_profile_id is null then null else now() end
      )
      on conflict (source_provider, licence_number)
      do update set first_name = excluded.first_name,
                    last_name = excluded.last_name,
                    profile_id = coalesce(championship_players.profile_id, excluded.profile_id),
                    link_status = case
                      when championship_players.profile_id is not null then championship_players.link_status
                      when excluded.profile_id is not null then 'verified'::public.championship_player_link_status
                      else championship_players.link_status
                    end,
                    linked_at = case
                      when championship_players.profile_id is not null then championship_players.linked_at
                      when excluded.profile_id is not null then now()
                      else championship_players.linked_at
                    end,
                    updated_at = now()
      returning id into player_id;

      insert into public.championship_team_players (
        team_id,
        player_id,
        source_entry,
        source_flags
      )
      values (
        team_id,
        player_id,
        coalesce(player_row ->> 'sourceEntry', ''),
        case
          when jsonb_typeof(player_row -> 'sourceFlags') = 'array'
          then array(select jsonb_array_elements_text(player_row -> 'sourceFlags'))
          else '{}'::text[]
        end
      )
      on conflict (team_id, player_id)
      do update set source_entry = excluded.source_entry,
                    source_flags = excluded.source_flags;
    end loop;
  end loop;

  for source_row in select * from jsonb_array_elements(payload -> 'matches')
  loop
    category := public.championship_import_normalize(source_row ->> 'category');
    status_text := btrim(source_row ->> 'status');
    if status_text not in ('to_schedule', 'scheduled', 'postponed', 'played', 'forfeit', 'cancelled')
      or nullif(btrim(source_row ->> 'phase'), '') is null
      or nullif(btrim(source_row ->> 'sourceKey'), '') is null
    then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;

    select division.id into division_id
    from public.championship_divisions as division
    where division.championship_id = championship_id
      and division.normalized_name = category;

    select team.id, team.pool_id
    into team1_id, team1_pool_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = division_id
      and federation_club.source_provider = source_provider
      and federation_club.normalized_name = public.championship_import_normalize(source_row #>> '{team1,clubName}')
      and team.team_number = btrim(source_row #>> '{team1,teamNumber}');

    select team.id, team.pool_id
    into team2_id, team2_pool_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = division_id
      and federation_club.source_provider = source_provider
      and federation_club.normalized_name = public.championship_import_normalize(source_row #>> '{team2,clubName}')
      and team.team_number = btrim(source_row #>> '{team2,teamNumber}');

    if division_id is null or team1_id is null or team2_id is null then
      raise exception 'Championship import payload is invalid' using errcode = '22023';
    end if;

    pool_id := case
      when team1_pool_id is not null and team1_pool_id = team2_pool_id then team1_pool_id
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
      division_id,
      pool_id,
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
      status_text::public.championship_match_status,
      nullif(source_row ->> 'scoreTeam1', '')::integer,
      nullif(source_row ->> 'scoreTeam2', '')::integer,
      nullif(btrim(source_row ->> 'scoreRaw'), ''),
      nullif(btrim(source_row ->> 'resultComment'), ''),
      coalesce(source_row -> 'sourceMetadata', '{}'::jsonb),
      matches_file_id
    )
    on conflict (division_id, source_key)
    do update set pool_id = excluded.pool_id,
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
    'divisionCount', (select count(*) from public.championship_divisions where championship_id = championship_id),
    'poolCount', (
      select count(*)
      from public.championship_pools as pool
      join public.championship_divisions as division on division.id = pool.division_id
      where division.championship_id = championship_id
    ),
    'clubCount', (
      select count(distinct team.federation_club_id)
      from public.championship_teams as team
      join public.championship_divisions as division on division.id = team.division_id
      where division.championship_id = championship_id
    ),
    'teamCount', (
      select count(*)
      from public.championship_teams as team
      join public.championship_divisions as division on division.id = team.division_id
      where division.championship_id = championship_id
    ),
    'playerCount', (
      select count(distinct team_player.player_id)
      from public.championship_team_players as team_player
      join public.championship_teams as team on team.id = team_player.team_id
      join public.championship_divisions as division on division.id = team.division_id
      where division.championship_id = championship_id
    ),
    'matchCount', (
      select count(*)
      from public.championship_matches as match
      join public.championship_divisions as division on division.id = match.division_id
      where division.championship_id = championship_id
    ),
    'linkedPlayerCount', (
      select count(distinct player.id)
      from public.championship_players as player
      join public.championship_team_players as team_player on team_player.player_id = player.id
      join public.championship_teams as team on team.id = team_player.team_id
      join public.championship_divisions as division on division.id = team.division_id
      where division.championship_id = championship_id
        and player.profile_id is not null
    )
  ) into summary;

  update public.championship_import_batches
  set status = 'applied',
      summary = summary,
      applied_at = now()
  where id = batch_id;

  update public.championships
  set updated_by = actor_id,
      updated_at = now()
  where id = championship_id;

  insert into public.championship_audit_log (
    championship_id,
    club_id,
    actor_id,
    action,
    payload
  )
  values (
    championship_id,
    target_club_id,
    actor_id,
    'source_import.applied',
    jsonb_build_object(
      'batchId', batch_id,
      'sourceExternalId', source_external_id,
      'summary', summary
    )
  );

  return jsonb_build_object(
    'championshipId', championship_id,
    'batchId', batch_id,
    'alreadyImported', false,
    'summary', summary
  );
end;
$$;

revoke all on function public.championship_import_normalize(text) from public, anon, authenticated;
revoke all on function public.admin_import_championship_sources(jsonb) from public, anon, authenticated;
grant execute on function public.admin_import_championship_sources(jsonb) to authenticated;
