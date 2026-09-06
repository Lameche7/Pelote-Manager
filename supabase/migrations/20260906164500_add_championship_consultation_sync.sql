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
    'seasonLabel', championship.season_label,
    'status', championship.status,
    'sourceProvider', championship.source_provider,
    'sourceExternalId', championship.source_external_id,
    'sourceUrl', championship.source_url,
    'updatedAt', championship.updated_at,
    'latestImportAt', (
      select batch.applied_at
      from public.championship_import_batches as batch
      where batch.championship_id = championship.id
        and batch.status = 'applied'
      order by batch.applied_at desc nulls last, batch.created_at desc
      limit 1
    ),
    'counts', jsonb_build_object(
      'divisionCount', (
        select count(*)
        from public.championship_divisions as division
        where division.championship_id = championship.id
      ),
      'poolCount', (
        select count(*)
        from public.championship_pools as pool
        join public.championship_divisions as division on division.id = pool.division_id
        where division.championship_id = championship.id
      ),
      'teamCount', (
        select count(*)
        from public.championship_teams as team
        join public.championship_divisions as division on division.id = team.division_id
        where division.championship_id = championship.id
      ),
      'playerCount', (
        select count(distinct team_player.player_id)
        from public.championship_team_players as team_player
        join public.championship_teams as team on team.id = team_player.team_id
        join public.championship_divisions as division on division.id = team.division_id
        where division.championship_id = championship.id
      ),
      'matchCount', (
        select count(*)
        from public.championship_matches as match
        join public.championship_divisions as division on division.id = match.division_id
        where division.championship_id = championship.id
      ),
      'playedMatchCount', (
        select count(*)
        from public.championship_matches as match
        join public.championship_divisions as division on division.id = match.division_id
        where division.championship_id = championship.id
          and match.status = 'played'
      ),
      'linkedPlayerCount', (
        select count(distinct player.id)
        from public.championship_players as player
        join public.championship_team_players as team_player on team_player.player_id = player.id
        join public.championship_teams as team on team.id = team_player.team_id
        join public.championship_divisions as division on division.id = team.division_id
        where division.championship_id = championship.id
          and player.profile_id is not null
      )
    ),
    'divisions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', division.id,
            'name', division.name,
            'displayOrder', division.display_order,
            'pools', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', pool.id,
                    'code', pool.code,
                    'name', pool.name,
                    'teams', (
                      select coalesce(
                        jsonb_agg(
                          jsonb_build_object(
                            'id', team.id,
                            'sourceLabel', team.source_label,
                            'teamNumber', team.team_number,
                            'clubName', federation_club.name,
                            'players', (
                              select coalesce(
                                jsonb_agg(
                                  jsonb_build_object(
                                    'id', player.id,
                                    'licenceNumber', player.licence_number,
                                    'firstName', player.first_name,
                                    'lastName', player.last_name,
                                    'profileId', player.profile_id,
                                    'linkStatus', player.link_status
                                  )
                                  order by player.last_name, player.first_name
                                ),
                                '[]'::jsonb
                              )
                              from public.championship_team_players as team_player
                              join public.championship_players as player on player.id = team_player.player_id
                              where team_player.team_id = team.id
                            )
                          )
                          order by federation_club.name, team.team_number
                        ),
                        '[]'::jsonb
                      )
                      from public.championship_teams as team
                      join public.championship_federation_clubs as federation_club
                        on federation_club.id = team.federation_club_id
                      where team.pool_id = pool.id
                    )
                  )
                  order by pool.display_order, pool.code
                ),
                '[]'::jsonb
              )
              from public.championship_pools as pool
              where pool.division_id = division.id
            ),
            'teamsWithoutPool', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'id', team.id,
                    'sourceLabel', team.source_label,
                    'teamNumber', team.team_number,
                    'clubName', federation_club.name,
                    'players', (
                      select coalesce(
                        jsonb_agg(
                          jsonb_build_object(
                            'id', player.id,
                            'licenceNumber', player.licence_number,
                            'firstName', player.first_name,
                            'lastName', player.last_name,
                            'profileId', player.profile_id,
                            'linkStatus', player.link_status
                          )
                          order by player.last_name, player.first_name
                        ),
                        '[]'::jsonb
                      )
                      from public.championship_team_players as team_player
                      join public.championship_players as player on player.id = team_player.player_id
                      where team_player.team_id = team.id
                    )
                  )
                  order by federation_club.name, team.team_number
                ),
                '[]'::jsonb
              )
              from public.championship_teams as team
              join public.championship_federation_clubs as federation_club
                on federation_club.id = team.federation_club_id
              where team.division_id = division.id
                and team.pool_id is null
            )
          )
          order by division.display_order, division.name
        ),
        '[]'::jsonb
      )
      from public.championship_divisions as division
      where division.championship_id = championship.id
    ),
    'matches', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', match.id,
            'divisionId', division.id,
            'divisionName', division.name,
            'poolCode', pool.code,
            'phase', match.phase,
            'sourceKey', match.source_key,
            'team1Label', team1.source_label,
            'team2Label', team2.source_label,
            'scheduledOn', match.scheduled_on,
            'scheduledTime', match.scheduled_time,
            'reportOn', match.report_on,
            'reportTime', match.report_time,
            'venue', match.venue,
            'agreementOn', match.agreement_on,
            'agreementTime', match.agreement_time,
            'agreementVenue', match.agreement_venue,
            'status', match.status,
            'scoreRaw', match.score_raw,
            'scoreTeam1', match.score_team1,
            'scoreTeam2', match.score_team2,
            'resultComment', match.result_comment,
            'sourceMetadata', match.source_metadata
          )
          order by
            coalesce(match.report_on, match.agreement_on, match.scheduled_on) nulls last,
            division.display_order,
            match.phase,
            team1.source_label,
            team2.source_label
        ),
        '[]'::jsonb
      )
      from public.championship_matches as match
      join public.championship_divisions as division on division.id = match.division_id
      left join public.championship_pools as pool on pool.id = match.pool_id
      join public.championship_teams as team1 on team1.id = match.team1_id
      join public.championship_teams as team2 on team2.id = match.team2_id
      where division.championship_id = championship.id
    )
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
  championship_row record;
  file_row jsonb := payload -> 'file';
  source_url text := nullif(btrim(payload ->> 'sourceUrl'), '');
  source_external_id text := nullif(btrim(payload ->> 'sourceExternalId'), '');
  batch_id uuid;
  file_id uuid;
  source_row jsonb;
  division_id uuid;
  team1_id uuid;
  team2_id uuid;
  team1_pool_id uuid;
  team2_pool_id uuid;
  pool_id uuid;
  match_ids uuid[];
  existing_count integer;
  match_id uuid;
  changed_match_id uuid;
  inserted_count integer := 0;
  updated_count integer := 0;
  unchanged_count integer := 0;
  current_status text;
  summary jsonb;
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select championship.name,
         championship.specialty,
         championship.source_provider,
         championship.source_external_id
  into championship_row
  from public.championships as championship
  where championship.id = target_id;

  if championship_row is null then
    raise exception 'Championship not found' using errcode = 'P0002';
  end if;

  if payload is null
    or jsonb_typeof(payload) <> 'object'
    or jsonb_typeof(payload -> 'matches') <> 'array'
    or jsonb_array_length(payload -> 'matches') = 0
    or file_row is null
    or jsonb_typeof(file_row) <> 'object'
    or file_row ->> 'kind' <> 'matches'
    or nullif(btrim(file_row ->> 'fileName'), '') is null
    or nullif(btrim(file_row ->> 'checksum'), '') is null
  then
    raise exception 'Championship update payload is invalid' using errcode = '22023';
  end if;

  if public.championship_import_normalize(payload ->> 'competition') <>
       public.championship_import_normalize(championship_row.name)
    or public.championship_import_normalize(payload ->> 'specialty') <>
       public.championship_import_normalize(championship_row.specialty)
  then
    raise exception 'Championship update source mismatch' using errcode = '22023';
  end if;

  if source_external_id is not null then
    if championship_row.source_external_id is not null
      and championship_row.source_external_id <> source_external_id
    then
      raise exception 'Championship update source mismatch' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.championships as other
      where other.id <> target_id
        and other.source_provider = championship_row.source_provider
        and other.source_external_id = source_external_id
    ) then
      raise exception 'Championship update source already used' using errcode = '23505';
    end if;
  end if;

  insert into public.championship_import_batches (
    championship_id,
    club_id,
    status,
    source_url,
    summary,
    created_by
  )
  values (
    target_id,
    target_club_id,
    'preview',
    source_url,
    '{}'::jsonb,
    actor_id
  )
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
    btrim(file_row ->> 'fileName'),
    btrim(file_row ->> 'checksum'),
    greatest(coalesce((file_row ->> 'rowCount')::integer, 0), 0),
    '{}'::jsonb
  )
  returning id into file_id;

  for source_row in
    select * from jsonb_array_elements(payload -> 'matches')
  loop
    current_status := btrim(source_row ->> 'status');
    if current_status not in (
      'to_schedule',
      'scheduled',
      'postponed',
      'played',
      'forfeit',
      'cancelled'
    )
      or nullif(btrim(source_row ->> 'category'), '') is null
      or nullif(btrim(source_row ->> 'phase'), '') is null
      or nullif(btrim(source_row ->> 'sourceKey'), '') is null
      or nullif(btrim(source_row #>> '{team1,clubName}'), '') is null
      or nullif(btrim(source_row #>> '{team1,teamNumber}'), '') is null
      or nullif(btrim(source_row #>> '{team2,clubName}'), '') is null
      or nullif(btrim(source_row #>> '{team2,teamNumber}'), '') is null
    then
      raise exception 'Championship update payload is invalid' using errcode = '22023';
    end if;

    select division.id
    into division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = public.championship_import_normalize(
        source_row ->> 'category'
      );

    if division_id is null then
      raise exception 'Championship update division not found: %', source_row ->> 'category'
        using errcode = '22023';
    end if;

    team1_id := null;
    team1_pool_id := null;
    select team.id, team.pool_id
    into team1_id, team1_pool_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = division_id
      and federation_club.source_provider = championship_row.source_provider
      and federation_club.normalized_name = public.championship_import_normalize(
        source_row #>> '{team1,clubName}'
      )
      and team.team_number = btrim(source_row #>> '{team1,teamNumber}');

    team2_id := null;
    team2_pool_id := null;
    select team.id, team.pool_id
    into team2_id, team2_pool_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where team.division_id = division_id
      and federation_club.source_provider = championship_row.source_provider
      and federation_club.normalized_name = public.championship_import_normalize(
        source_row #>> '{team2,clubName}'
      )
      and team.team_number = btrim(source_row #>> '{team2,teamNumber}');

    if team1_id is null or team2_id is null then
      raise exception 'Championship update team not found: % / %',
        source_row #>> '{team1,clubName}',
        source_row #>> '{team2,clubName}'
        using errcode = '22023';
    end if;

    select array_agg(match.id order by match.created_at, match.id), count(*)
    into match_ids, existing_count
    from public.championship_matches as match
    where match.division_id = division_id
      and public.championship_import_normalize(match.phase) =
        public.championship_import_normalize(source_row ->> 'phase')
      and match.team1_id = team1_id
      and match.team2_id = team2_id;

    if existing_count > 1 then
      raise exception 'Championship update match is ambiguous' using errcode = '21000';
    end if;

    pool_id := case
      when team1_pool_id is not null and team1_pool_id = team2_pool_id
        then team1_pool_id
      else null
    end;

    if existing_count = 0 then
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
        current_status::public.championship_match_status,
        nullif(source_row ->> 'scoreTeam1', '')::integer,
        nullif(source_row ->> 'scoreTeam2', '')::integer,
        nullif(btrim(source_row ->> 'scoreRaw'), ''),
        nullif(btrim(source_row ->> 'resultComment'), ''),
        coalesce(source_row -> 'sourceMetadata', '{}'::jsonb),
        file_id
      );
      inserted_count := inserted_count + 1;
    else
      match_id := match_ids[1];
      changed_match_id := null;
      update public.championship_matches as match
      set pool_id = pool_id,
          phase = btrim(source_row ->> 'phase'),
          source_key = btrim(source_row ->> 'sourceKey'),
          team1_id = team1_id,
          team2_id = team2_id,
          scheduled_on = nullif(source_row ->> 'scheduledOn', '')::date,
          scheduled_time = nullif(source_row ->> 'scheduledTime', '')::time,
          report_on = nullif(source_row ->> 'reportOn', '')::date,
          report_time = nullif(source_row ->> 'reportTime', '')::time,
          venue = nullif(btrim(source_row ->> 'venue'), ''),
          agreement_on = nullif(source_row ->> 'agreementOn', '')::date,
          agreement_time = nullif(source_row ->> 'agreementTime', '')::time,
          agreement_venue = nullif(btrim(source_row ->> 'agreementVenue'), ''),
          status = current_status::public.championship_match_status,
          score_team1 = nullif(source_row ->> 'scoreTeam1', '')::integer,
          score_team2 = nullif(source_row ->> 'scoreTeam2', '')::integer,
          score_raw = nullif(btrim(source_row ->> 'scoreRaw'), ''),
          result_comment = nullif(btrim(source_row ->> 'resultComment'), ''),
          source_metadata = coalesce(source_row -> 'sourceMetadata', '{}'::jsonb),
          source_import_file_id = file_id,
          updated_at = now()
      where match.id = match_id
        and (
          match.pool_id is distinct from pool_id
          or match.phase is distinct from btrim(source_row ->> 'phase')
          or match.source_key is distinct from btrim(source_row ->> 'sourceKey')
          or match.team1_id is distinct from team1_id
          or match.team2_id is distinct from team2_id
          or match.scheduled_on is distinct from nullif(source_row ->> 'scheduledOn', '')::date
          or match.scheduled_time is distinct from nullif(source_row ->> 'scheduledTime', '')::time
          or match.report_on is distinct from nullif(source_row ->> 'reportOn', '')::date
          or match.report_time is distinct from nullif(source_row ->> 'reportTime', '')::time
          or match.venue is distinct from nullif(btrim(source_row ->> 'venue'), '')
          or match.agreement_on is distinct from nullif(source_row ->> 'agreementOn', '')::date
          or match.agreement_time is distinct from nullif(source_row ->> 'agreementTime', '')::time
          or match.agreement_venue is distinct from nullif(btrim(source_row ->> 'agreementVenue'), '')
          or match.status is distinct from current_status::public.championship_match_status
          or match.score_team1 is distinct from nullif(source_row ->> 'scoreTeam1', '')::integer
          or match.score_team2 is distinct from nullif(source_row ->> 'scoreTeam2', '')::integer
          or match.score_raw is distinct from nullif(btrim(source_row ->> 'scoreRaw'), '')
          or match.result_comment is distinct from nullif(btrim(source_row ->> 'resultComment'), '')
          or match.source_metadata is distinct from coalesce(source_row -> 'sourceMetadata', '{}'::jsonb)
        )
      returning match.id into changed_match_id;

      if changed_match_id is null then
        unchanged_count := unchanged_count + 1;
      else
        updated_count := updated_count + 1;
      end if;
    end if;
  end loop;

  summary := jsonb_build_object(
    'insertedMatches', inserted_count,
    'updatedMatches', updated_count,
    'unchangedMatches', unchanged_count,
    'fileMatchCount', jsonb_array_length(payload -> 'matches')
  );

  update public.championship_import_batches as batch
  set status = 'applied',
      summary = summary,
      applied_at = now()
  where batch.id = batch_id;

  update public.championships as championship
  set source_url = coalesce(source_url, championship.source_url),
      source_external_id = coalesce(championship.source_external_id, source_external_id),
      updated_by = actor_id,
      updated_at = now()
  where championship.id = target_id;

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
      'sourceExternalId', source_external_id,
      'summary', summary
    )
  );

  return jsonb_build_object(
    'championshipId', target_id,
    'batchId', batch_id,
    'summary', summary
  );
end;
$$;

revoke all on function public.admin_get_championship_detail(uuid)
from public, anon, authenticated;
revoke all on function public.admin_apply_championship_matches_update(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.admin_get_championship_detail(uuid)
to authenticated;
grant execute on function public.admin_apply_championship_matches_update(uuid, jsonb)
to authenticated;
