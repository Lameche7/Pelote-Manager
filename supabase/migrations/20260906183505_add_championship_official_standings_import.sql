create or replace function public.admin_preview_championship_standings_import(
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
  file_payload jsonb := payload -> 'file';
  incoming jsonb := payload -> 'standings';
  source_checksum text := nullif(btrim(file_payload ->> 'checksum'), '');
  incoming_count integer := 0;
  new_count integer := 0;
  changed_count integer := 0;
  unchanged_count integer := 0;
  touched_pools jsonb := '{}'::jsonb;
  issues jsonb := '[]'::jsonb;
  changes jsonb := '[]'::jsonb;
  seen_keys jsonb := '{}'::jsonb;
  item jsonb;
  division_id uuid;
  pool_id uuid;
  team_id uuid;
  division_normalized text;
  pool_code text;
  club_normalized text;
  team_number text;
  team_label text;
  incoming_rank integer;
  incoming_played integer;
  incoming_wins integer;
  incoming_draws integer;
  incoming_losses integer;
  incoming_points numeric;
  incoming_score_for integer;
  incoming_score_against integer;
  incoming_score_difference integer;
  existing public.championship_standings%rowtype;
  row_key text;
  prior_batch_id uuid;
  touched_pool_key text;
  expected_team_count integer;
  supplied_team_count integer;
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if payload is null
     or jsonb_typeof(incoming) <> 'array'
     or jsonb_array_length(incoming) = 0
     or file_payload ->> 'kind' <> 'standings'
     or source_checksum is null then
    raise exception 'Championship standings payload is invalid';
  end if;

  incoming_count := jsonb_array_length(incoming);

  select batch.id into prior_batch_id
  from public.championship_import_files as source_file
  join public.championship_import_batches as batch on batch.id = source_file.batch_id
  where batch.championship_id = target_id
    and batch.status = 'applied'
    and source_file.kind = 'standings'
    and source_file.checksum = source_checksum
  order by batch.applied_at desc nulls last, batch.created_at desc
  limit 1;

  if prior_batch_id is not null then
    return jsonb_build_object(
      'valid', true,
      'alreadyImported', true,
      'batchId', prior_batch_id,
      'summary', jsonb_build_object(
        'incomingCount', incoming_count,
        'newCount', 0,
        'changedCount', 0,
        'unchangedCount', incoming_count,
        'poolCount', 0
      ),
      'changes', '[]'::jsonb,
      'issues', '[]'::jsonb
    );
  end if;

  for item in select value from jsonb_array_elements(incoming)
  loop
    division_normalized := nullif(btrim(item ->> 'divisionNormalized'), '');
    pool_code := nullif(btrim(item ->> 'poolCode'), '');
    club_normalized := nullif(btrim(item ->> 'clubNormalized'), '');
    team_number := nullif(btrim(item ->> 'teamNumber'), '');
    team_label := coalesce(nullif(btrim(item ->> 'teamLabel'), ''), 'Équipe inconnue');
    incoming_rank := nullif(item ->> 'rank', '')::integer;
    incoming_played := nullif(item ->> 'played', '')::integer;
    incoming_wins := nullif(item ->> 'wins', '')::integer;
    incoming_draws := nullif(item ->> 'draws', '')::integer;
    incoming_losses := nullif(item ->> 'losses', '')::integer;
    incoming_points := nullif(item ->> 'points', '')::numeric;
    incoming_score_for := nullif(item ->> 'scoreFor', '')::integer;
    incoming_score_against := nullif(item ->> 'scoreAgainst', '')::integer;
    incoming_score_difference := nullif(item ->> 'scoreDifference', '')::integer;

    division_id := null;
    pool_id := null;
    team_id := null;

    if division_normalized is null or pool_code is null or club_normalized is null or team_number is null or incoming_rank is null or incoming_rank <= 0 then
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_row',
        'message', format('Ligne de classement incomplète pour %s.', team_label)
      ));
      continue;
    end if;

    select division.id into division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = division_normalized
    limit 1;

    if division_id is null then
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'division_not_found',
        'message', format('Série introuvable pour %s.', team_label)
      ));
      continue;
    end if;

    select pool.id into pool_id
    from public.championship_pools as pool
    where pool.division_id = division_id and pool.code = pool_code
    limit 1;

    if pool_id is null then
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'pool_not_found',
        'message', format('Poule %s introuvable pour %s.', pool_code, team_label)
      ));
      continue;
    end if;

    select team.id into team_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club on federation_club.id = team.federation_club_id
    where team.division_id = division_id
      and team.pool_id = pool_id
      and team.team_number = team_number
      and federation_club.normalized_name = club_normalized
    limit 1;

    if team_id is null then
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'team_not_found',
        'message', format('Équipe officielle introuvable : %s.', team_label)
      ));
      continue;
    end if;

    row_key := pool_id::text || ':' || team_id::text;
    if seen_keys ? row_key then
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'duplicate_team',
        'message', format('L’équipe %s apparaît plusieurs fois dans la même poule.', team_label)
      ));
      continue;
    end if;
    seen_keys := seen_keys || jsonb_build_object(row_key, true);
    touched_pools := touched_pools || jsonb_build_object(pool_id::text, true);

    select standing.* into existing
    from public.championship_standings as standing
    where standing.pool_id = pool_id and standing.team_id = team_id;

    if not found then
      new_count := new_count + 1;
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'new', 'teamLabel', team_label, 'poolCode', pool_code, 'rank', incoming_rank
      ));
    elsif existing.rank is distinct from incoming_rank
       or existing.played is distinct from incoming_played
       or existing.wins is distinct from incoming_wins
       or existing.draws is distinct from incoming_draws
       or existing.losses is distinct from incoming_losses
       or existing.points is distinct from incoming_points
       or existing.score_for is distinct from incoming_score_for
       or existing.score_against is distinct from incoming_score_against
       or existing.score_difference is distinct from incoming_score_difference then
      changed_count := changed_count + 1;
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'changed', 'teamLabel', team_label, 'poolCode', pool_code,
        'previousRank', existing.rank, 'rank', incoming_rank
      ));
    else
      unchanged_count := unchanged_count + 1;
    end if;
  end loop;

  for touched_pool_key in select key from jsonb_object_keys(touched_pools) as key
  loop
    select count(*)::integer into expected_team_count
    from public.championship_teams
    where pool_id = touched_pool_key::uuid;

    select count(*)::integer into supplied_team_count
    from jsonb_object_keys(seen_keys) as supplied(key)
    where supplied.key like touched_pool_key || ':%';

    if supplied_team_count <> expected_team_count then
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'incomplete_pool',
        'message', format(
          'Le classement de la poule est incomplet : %s équipe(s) fournie(s) sur %s. Aucune ligne de cette poule ne sera remplacée tant que le fichier n’est pas complet.',
          supplied_team_count,
          expected_team_count
        )
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'valid', jsonb_array_length(issues) = 0,
    'alreadyImported', false,
    'batchId', null,
    'summary', jsonb_build_object(
      'incomingCount', incoming_count,
      'newCount', new_count,
      'changedCount', changed_count,
      'unchangedCount', unchanged_count,
      'poolCount', (select count(*) from jsonb_object_keys(touched_pools))
    ),
    'changes', changes,
    'issues', issues
  );
end;
$$;

create or replace function public.admin_apply_championship_standings_import(
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
  file_payload jsonb := payload -> 'file';
  incoming jsonb := payload -> 'standings';
  source_checksum text := nullif(btrim(file_payload ->> 'checksum'), '');
  prior_batch_id uuid;
  batch_id uuid;
  import_file_id uuid;
  item jsonb;
  division_id uuid;
  pool_id uuid;
  team_id uuid;
  touched_pool_id uuid;
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  preview := public.admin_preview_championship_standings_import(target_id, payload);
  if not coalesce((preview ->> 'valid')::boolean, false) then
    raise exception 'Championship standings import is invalid';
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
    championship_id, club_id, status, source_url, summary, created_by, applied_at
  ) values (
    target_id, target_club_id, 'applied', nullif(btrim(file_payload ->> 'sourceUrl'), ''),
    preview -> 'summary', actor_id, now()
  ) returning id into batch_id;

  insert into public.championship_import_files (
    batch_id, kind, file_name, checksum, row_count, metadata
  ) values (
    batch_id, 'standings',
    coalesce(nullif(btrim(file_payload ->> 'fileName'), ''), 'classement.xlsx'),
    source_checksum,
    coalesce(nullif(file_payload ->> 'rowCount', '')::integer, jsonb_array_length(incoming)),
    jsonb_build_object('sourceUrl', file_payload ->> 'sourceUrl')
  ) returning id into import_file_id;

  for touched_pool_id in
    select distinct pool.id
    from jsonb_array_elements(incoming) as source_row(value)
    join public.championship_divisions as division
      on division.championship_id = target_id
     and division.normalized_name = source_row.value ->> 'divisionNormalized'
    join public.championship_pools as pool
      on pool.division_id = division.id
     and pool.code = source_row.value ->> 'poolCode'
  loop
    delete from public.championship_standings as standing
    where standing.pool_id = touched_pool_id;
  end loop;

  for item in select value from jsonb_array_elements(incoming)
  loop
    select division.id into division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = item ->> 'divisionNormalized'
    limit 1;

    select pool.id into pool_id
    from public.championship_pools as pool
    where pool.division_id = division_id and pool.code = item ->> 'poolCode'
    limit 1;

    select team.id into team_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club on federation_club.id = team.federation_club_id
    where team.division_id = division_id
      and team.pool_id = pool_id
      and team.team_number = item ->> 'teamNumber'
      and federation_club.normalized_name = item ->> 'clubNormalized'
    limit 1;

    insert into public.championship_standings (
      pool_id, team_id, rank, played, wins, draws, losses, points,
      score_for, score_against, score_difference, source_payload,
      source_import_file_id, updated_at
    ) values (
      pool_id,
      team_id,
      nullif(item ->> 'rank', '')::integer,
      nullif(item ->> 'played', '')::integer,
      nullif(item ->> 'wins', '')::integer,
      nullif(item ->> 'draws', '')::integer,
      nullif(item ->> 'losses', '')::integer,
      nullif(item ->> 'points', '')::numeric,
      nullif(item ->> 'scoreFor', '')::integer,
      nullif(item ->> 'scoreAgainst', '')::integer,
      nullif(item ->> 'scoreDifference', '')::integer,
      coalesce(item -> 'sourcePayload', '{}'::jsonb),
      import_file_id,
      now()
    );
  end loop;

  insert into public.championship_audit_log (
    championship_id, club_id, actor_id, action, payload
  ) values (
    target_id, target_club_id, actor_id, 'standings.imported',
    jsonb_build_object(
      'batchId', batch_id,
      'fileName', file_payload ->> 'fileName',
      'checksum', source_checksum,
      'summary', preview -> 'summary'
    )
  );

  update public.championships
  set updated_at = now(), updated_by = actor_id
  where id = target_id;

  return jsonb_build_object(
    'championshipId', target_id,
    'batchId', batch_id,
    'alreadyImported', false,
    'summary', preview -> 'summary'
  );
end;
$$;

revoke all on function public.admin_preview_championship_standings_import(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_apply_championship_standings_import(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_preview_championship_standings_import(uuid, jsonb) to authenticated;
grant execute on function public.admin_apply_championship_standings_import(uuid, jsonb) to authenticated;

create or replace function public.get_my_championships()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with my_teams as (
    select distinct
      championship.id as championship_id,
      championship.name as championship_name,
      championship.specialty,
      championship.season_label,
      championship.status as championship_status,
      championship.source_url,
      division.id as division_id,
      division.name as division_name,
      pool.id as pool_id,
      pool.code as pool_code,
      pool.name as pool_name,
      team.id as team_id,
      team.source_label as team_label,
      federation_club.name as club_name,
      coalesce(standing.rank, team.source_rank) as official_rank
    from public.championship_players as player
    join public.championship_team_players as team_player on team_player.player_id = player.id
    join public.championship_teams as team on team.id = team_player.team_id
    join public.championship_divisions as division on division.id = team.division_id
    join public.championships as championship on championship.id = division.championship_id
    join public.championship_federation_clubs as federation_club on federation_club.id = team.federation_club_id
    left join public.championship_pools as pool on pool.id = team.pool_id
    left join public.championship_standings as standing on standing.pool_id = team.pool_id and standing.team_id = team.id
    where player.profile_id = auth.uid()
      and player.link_status in ('claimed', 'verified')
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'championship_id', mine.championship_id,
        'championship_name', mine.championship_name,
        'specialty', mine.specialty,
        'season_label', mine.season_label,
        'championship_status', mine.championship_status,
        'source_url', mine.source_url,
        'division_id', mine.division_id,
        'division_name', mine.division_name,
        'pool_id', mine.pool_id,
        'pool_code', mine.pool_code,
        'pool_name', mine.pool_name,
        'team_id', mine.team_id,
        'team_label', mine.team_label,
        'club_name', mine.club_name,
        'official_rank', mine.official_rank,
        'players', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'first_name', player.first_name,
                'last_name', player.last_name,
                'is_me', player.profile_id = auth.uid()
              ) order by player.last_name, player.first_name
            ),
            '[]'::jsonb
          )
          from public.championship_team_players as team_player
          join public.championship_players as player on player.id = team_player.player_id
          where team_player.team_id = mine.team_id
        ),
        'pool_standings', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'team_id', pool_team.id,
                'team_label', pool_team.source_label,
                'club_name', pool_club.name,
                'team_number', pool_team.team_number,
                'official_rank', coalesce(pool_standing.rank, pool_team.source_rank),
                'official_points', pool_standing.points,
                'stats_source', case when pool_standing.team_id is not null then 'official' else 'calculated' end,
                'is_my_team', pool_team.id = mine.team_id,
                'played', coalesce(pool_standing.played, stats.played, 0),
                'wins', coalesce(pool_standing.wins, stats.wins, 0),
                'draws', coalesce(pool_standing.draws, stats.draws, 0),
                'losses', coalesce(pool_standing.losses, stats.losses, 0),
                'score_for', coalesce(pool_standing.score_for, stats.score_for, 0),
                'score_against', coalesce(pool_standing.score_against, stats.score_against, 0),
                'score_difference', coalesce(
                  pool_standing.score_difference,
                  case
                    when pool_standing.score_for is not null and pool_standing.score_against is not null
                      then pool_standing.score_for - pool_standing.score_against
                    else coalesce(stats.score_for, 0) - coalesce(stats.score_against, 0)
                  end
                )
              )
              order by coalesce(pool_standing.rank, pool_team.source_rank) nulls last, pool_team.source_label
            ),
            '[]'::jsonb
          )
          from public.championship_teams as pool_team
          join public.championship_federation_clubs as pool_club on pool_club.id = pool_team.federation_club_id
          left join public.championship_standings as pool_standing on pool_standing.pool_id = pool_team.pool_id and pool_standing.team_id = pool_team.id
          left join lateral (
            select
              count(*)::integer as played,
              count(*) filter (
                where (match.team1_id = pool_team.id and match.score_team1 > match.score_team2)
                   or (match.team2_id = pool_team.id and match.score_team2 > match.score_team1)
              )::integer as wins,
              count(*) filter (where match.score_team1 = match.score_team2)::integer as draws,
              count(*) filter (
                where (match.team1_id = pool_team.id and match.score_team1 < match.score_team2)
                   or (match.team2_id = pool_team.id and match.score_team2 < match.score_team1)
              )::integer as losses,
              coalesce(sum(case when match.team1_id = pool_team.id then match.score_team1 else match.score_team2 end), 0)::integer as score_for,
              coalesce(sum(case when match.team1_id = pool_team.id then match.score_team2 else match.score_team1 end), 0)::integer as score_against
            from public.championship_matches as match
            where match.pool_id = mine.pool_id
              and pool_team.id in (match.team1_id, match.team2_id)
              and match.score_team1 is not null
              and match.score_team2 is not null
          ) as stats on true
          where mine.pool_id is not null and pool_team.pool_id = mine.pool_id
        ),
        'matches', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', match.id,
                'phase', match.phase,
                'pool_code', pool.code,
                'team_side', case when match.team1_id = mine.team_id then 'a' else 'b' end,
                'opponent_team_id', case when match.team1_id = mine.team_id then match.team2_id else match.team1_id end,
                'opponent_label', case when match.team1_id = mine.team_id then opponent2.source_label else opponent1.source_label end,
                'scheduled_on', match.scheduled_on,
                'scheduled_time', match.scheduled_time,
                'report_on', match.report_on,
                'report_time', match.report_time,
                'agreement_on', match.agreement_on,
                'agreement_time', match.agreement_time,
                'venue', match.venue,
                'agreement_venue', match.agreement_venue,
                'status', match.status,
                'score_raw', match.score_raw,
                'score_mine', case when match.team1_id = mine.team_id then match.score_team1 else match.score_team2 end,
                'score_opponent', case when match.team1_id = mine.team_id then match.score_team2 else match.score_team1 end,
                'result_comment', match.result_comment
              )
              order by
                coalesce(match.agreement_on, match.report_on, match.scheduled_on) nulls last,
                coalesce(match.agreement_time, match.report_time, match.scheduled_time) nulls last,
                match.phase,
                match.id
            ),
            '[]'::jsonb
          )
          from public.championship_matches as match
          left join public.championship_pools as pool on pool.id = match.pool_id
          left join public.championship_teams as opponent1 on opponent1.id = match.team1_id
          left join public.championship_teams as opponent2 on opponent2.id = match.team2_id
          where mine.team_id in (match.team1_id, match.team2_id)
        )
      )
      order by mine.season_label desc, mine.championship_name, mine.division_name
    ),
    '[]'::jsonb
  )
  from my_teams as mine;
$$;

revoke all on function public.get_my_championships() from public, anon, authenticated;
grant execute on function public.get_my_championships() to authenticated;
