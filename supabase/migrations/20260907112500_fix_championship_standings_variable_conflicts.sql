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
  v_target_club_id uuid := public.admin_current_club_id();
  v_file_payload jsonb := payload -> 'file';
  v_incoming jsonb := payload -> 'standings';
  v_source_checksum text := nullif(btrim(v_file_payload ->> 'checksum'), '');
  v_incoming_count integer := 0;
  v_new_count integer := 0;
  v_changed_count integer := 0;
  v_unchanged_count integer := 0;
  v_touched_pools jsonb := '{}'::jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_seen_keys jsonb := '{}'::jsonb;
  v_item jsonb;
  v_division_id uuid;
  v_pool_id uuid;
  v_team_id uuid;
  v_division_normalized text;
  v_pool_code text;
  v_club_normalized text;
  v_team_number text;
  v_team_label text;
  v_incoming_rank integer;
  v_incoming_played integer;
  v_incoming_wins integer;
  v_incoming_draws integer;
  v_incoming_losses integer;
  v_incoming_points numeric;
  v_incoming_score_for integer;
  v_incoming_score_against integer;
  v_incoming_score_difference integer;
  v_existing public.championship_standings%rowtype;
  v_row_key text;
  v_prior_batch_id uuid;
  v_touched_pool_key text;
  v_expected_team_count integer;
  v_supplied_team_count integer;
begin
  if not public.championship_club_can_manage(target_id, v_target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if payload is null
     or jsonb_typeof(v_incoming) <> 'array'
     or jsonb_array_length(v_incoming) = 0
     or v_file_payload ->> 'kind' <> 'standings'
     or v_source_checksum is null then
    raise exception 'Championship standings payload is invalid';
  end if;

  v_incoming_count := jsonb_array_length(v_incoming);

  select batch.id into v_prior_batch_id
  from public.championship_import_files as source_file
  join public.championship_import_batches as batch on batch.id = source_file.batch_id
  where batch.championship_id = target_id
    and batch.status = 'applied'
    and source_file.kind = 'standings'
    and source_file.checksum = v_source_checksum
  order by batch.applied_at desc nulls last, batch.created_at desc
  limit 1;

  if v_prior_batch_id is not null then
    return jsonb_build_object(
      'valid', true,
      'alreadyImported', true,
      'batchId', v_prior_batch_id,
      'summary', jsonb_build_object(
        'incomingCount', v_incoming_count,
        'newCount', 0,
        'changedCount', 0,
        'unchangedCount', v_incoming_count,
        'poolCount', 0
      ),
      'changes', '[]'::jsonb,
      'issues', '[]'::jsonb
    );
  end if;

  for v_item in select value from jsonb_array_elements(v_incoming)
  loop
    v_division_normalized := nullif(btrim(v_item ->> 'divisionNormalized'), '');
    v_pool_code := nullif(btrim(v_item ->> 'poolCode'), '');
    v_club_normalized := nullif(btrim(v_item ->> 'clubNormalized'), '');
    v_team_number := nullif(btrim(v_item ->> 'teamNumber'), '');
    v_team_label := coalesce(nullif(btrim(v_item ->> 'teamLabel'), ''), 'Équipe inconnue');
    v_incoming_rank := nullif(v_item ->> 'rank', '')::integer;
    v_incoming_played := nullif(v_item ->> 'played', '')::integer;
    v_incoming_wins := nullif(v_item ->> 'wins', '')::integer;
    v_incoming_draws := nullif(v_item ->> 'draws', '')::integer;
    v_incoming_losses := nullif(v_item ->> 'losses', '')::integer;
    v_incoming_points := nullif(v_item ->> 'points', '')::numeric;
    v_incoming_score_for := nullif(v_item ->> 'scoreFor', '')::integer;
    v_incoming_score_against := nullif(v_item ->> 'scoreAgainst', '')::integer;
    v_incoming_score_difference := nullif(v_item ->> 'scoreDifference', '')::integer;

    v_division_id := null;
    v_pool_id := null;
    v_team_id := null;

    if v_division_normalized is null or v_pool_code is null or v_club_normalized is null or v_team_number is null or v_incoming_rank is null or v_incoming_rank <= 0 then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_row',
        'message', format('Ligne de classement incomplète pour %s.', v_team_label)
      ));
      continue;
    end if;

    select division.id into v_division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = v_division_normalized
    limit 1;

    if v_division_id is null then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'division_not_found',
        'message', format('Série introuvable pour %s.', v_team_label)
      ));
      continue;
    end if;

    select pool.id into v_pool_id
    from public.championship_pools as pool
    where pool.division_id = v_division_id and pool.code = v_pool_code
    limit 1;

    if v_pool_id is null then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'pool_not_found',
        'message', format('Poule %s introuvable pour %s.', v_pool_code, v_team_label)
      ));
      continue;
    end if;

    select team.id into v_team_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club on federation_club.id = team.federation_club_id
    where team.division_id = v_division_id
      and team.pool_id = v_pool_id
      and team.team_number = v_team_number
      and federation_club.normalized_name = v_club_normalized
    limit 1;

    if v_team_id is null then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'team_not_found',
        'message', format('Équipe officielle introuvable : %s.', v_team_label)
      ));
      continue;
    end if;

    v_row_key := v_pool_id::text || ':' || v_team_id::text;
    if v_seen_keys ? v_row_key then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'duplicate_team',
        'message', format('L’équipe %s apparaît plusieurs fois dans la même poule.', v_team_label)
      ));
      continue;
    end if;
    v_seen_keys := v_seen_keys || jsonb_build_object(v_row_key, true);
    v_touched_pools := v_touched_pools || jsonb_build_object(v_pool_id::text, true);

    select standing.* into v_existing
    from public.championship_standings as standing
    where standing.pool_id = v_pool_id and standing.team_id = v_team_id;

    if not found then
      v_new_count := v_new_count + 1;
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'kind', 'new', 'teamLabel', v_team_label, 'poolCode', v_pool_code, 'rank', v_incoming_rank
      ));
    elsif v_existing.rank is distinct from v_incoming_rank
       or v_existing.played is distinct from v_incoming_played
       or v_existing.wins is distinct from v_incoming_wins
       or v_existing.draws is distinct from v_incoming_draws
       or v_existing.losses is distinct from v_incoming_losses
       or v_existing.points is distinct from v_incoming_points
       or v_existing.score_for is distinct from v_incoming_score_for
       or v_existing.score_against is distinct from v_incoming_score_against
       or v_existing.score_difference is distinct from v_incoming_score_difference then
      v_changed_count := v_changed_count + 1;
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'kind', 'changed', 'teamLabel', v_team_label, 'poolCode', v_pool_code,
        'previousRank', v_existing.rank, 'rank', v_incoming_rank
      ));
    else
      v_unchanged_count := v_unchanged_count + 1;
    end if;
  end loop;

  for v_touched_pool_key in
    select keys.key from jsonb_object_keys(v_touched_pools) as keys(key)
  loop
    select count(*)::integer into v_expected_team_count
    from public.championship_teams as team
    where team.pool_id = v_touched_pool_key::uuid;

    select count(*)::integer into v_supplied_team_count
    from jsonb_object_keys(v_seen_keys) as supplied(key)
    where supplied.key like v_touched_pool_key || ':%';

    if v_supplied_team_count <> v_expected_team_count then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'incomplete_pool',
        'message', format(
          'Le classement de la poule est incomplet : %s équipe(s) fournie(s) sur %s. Aucune ligne de cette poule ne sera remplacée tant que le fichier n’est pas complet.',
          v_supplied_team_count,
          v_expected_team_count
        )
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'valid', jsonb_array_length(v_issues) = 0,
    'alreadyImported', false,
    'batchId', null,
    'summary', jsonb_build_object(
      'incomingCount', v_incoming_count,
      'newCount', v_new_count,
      'changedCount', v_changed_count,
      'unchangedCount', v_unchanged_count,
      'poolCount', (select count(*) from jsonb_object_keys(v_touched_pools))
    ),
    'changes', v_changes,
    'issues', v_issues
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
  v_target_club_id uuid := public.admin_current_club_id();
  v_actor_id uuid := auth.uid();
  v_preview jsonb;
  v_file_payload jsonb := payload -> 'file';
  v_incoming jsonb := payload -> 'standings';
  v_source_checksum text := nullif(btrim(v_file_payload ->> 'checksum'), '');
  v_prior_batch_id uuid;
  v_batch_id uuid;
  v_import_file_id uuid;
  v_item jsonb;
  v_division_id uuid;
  v_pool_id uuid;
  v_team_id uuid;
  v_touched_pool_id uuid;
begin
  if not public.championship_club_can_manage(target_id, v_target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  v_preview := public.admin_preview_championship_standings_import(target_id, payload);
  if not coalesce((v_preview ->> 'valid')::boolean, false) then
    raise exception 'Championship standings import is invalid';
  end if;

  if coalesce((v_preview ->> 'alreadyImported')::boolean, false) then
    v_prior_batch_id := nullif(v_preview ->> 'batchId', '')::uuid;
    return jsonb_build_object(
      'championshipId', target_id,
      'batchId', v_prior_batch_id,
      'alreadyImported', true,
      'summary', v_preview -> 'summary'
    );
  end if;

  insert into public.championship_import_batches (
    championship_id, club_id, status, source_url, summary, created_by, applied_at
  ) values (
    target_id, v_target_club_id, 'applied', nullif(btrim(v_file_payload ->> 'sourceUrl'), ''),
    v_preview -> 'summary', v_actor_id, now()
  ) returning id into v_batch_id;

  insert into public.championship_import_files (
    batch_id, kind, file_name, checksum, row_count, metadata
  ) values (
    v_batch_id, 'standings',
    coalesce(nullif(btrim(v_file_payload ->> 'fileName'), ''), 'classement.xlsx'),
    v_source_checksum,
    coalesce(nullif(v_file_payload ->> 'rowCount', '')::integer, jsonb_array_length(v_incoming)),
    jsonb_build_object('sourceUrl', v_file_payload ->> 'sourceUrl')
  ) returning id into v_import_file_id;

  for v_touched_pool_id in
    select distinct pool.id
    from jsonb_array_elements(v_incoming) as source_row(value)
    join public.championship_divisions as division
      on division.championship_id = target_id
     and division.normalized_name = source_row.value ->> 'divisionNormalized'
    join public.championship_pools as pool
      on pool.division_id = division.id
     and pool.code = source_row.value ->> 'poolCode'
  loop
    delete from public.championship_standings as standing
    where standing.pool_id = v_touched_pool_id;
  end loop;

  for v_item in select value from jsonb_array_elements(v_incoming)
  loop
    select division.id into v_division_id
    from public.championship_divisions as division
    where division.championship_id = target_id
      and division.normalized_name = v_item ->> 'divisionNormalized'
    limit 1;

    select pool.id into v_pool_id
    from public.championship_pools as pool
    where pool.division_id = v_division_id
      and pool.code = v_item ->> 'poolCode'
    limit 1;

    select team.id into v_team_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club on federation_club.id = team.federation_club_id
    where team.division_id = v_division_id
      and team.pool_id = v_pool_id
      and team.team_number = v_item ->> 'teamNumber'
      and federation_club.normalized_name = v_item ->> 'clubNormalized'
    limit 1;

    insert into public.championship_standings (
      pool_id, team_id, rank, played, wins, draws, losses, points,
      score_for, score_against, score_difference, source_payload,
      source_import_file_id, updated_at
    ) values (
      v_pool_id,
      v_team_id,
      nullif(v_item ->> 'rank', '')::integer,
      nullif(v_item ->> 'played', '')::integer,
      nullif(v_item ->> 'wins', '')::integer,
      nullif(v_item ->> 'draws', '')::integer,
      nullif(v_item ->> 'losses', '')::integer,
      nullif(v_item ->> 'points', '')::numeric,
      nullif(v_item ->> 'scoreFor', '')::integer,
      nullif(v_item ->> 'scoreAgainst', '')::integer,
      nullif(v_item ->> 'scoreDifference', '')::integer,
      coalesce(v_item -> 'sourcePayload', '{}'::jsonb),
      v_import_file_id,
      now()
    );
  end loop;

  insert into public.championship_audit_log (
    championship_id, club_id, actor_id, action, payload
  ) values (
    target_id, v_target_club_id, v_actor_id, 'standings.imported',
    jsonb_build_object(
      'batchId', v_batch_id,
      'fileName', v_file_payload ->> 'fileName',
      'checksum', v_source_checksum,
      'summary', v_preview -> 'summary'
    )
  );

  update public.championships as championship
  set updated_at = now(), updated_by = v_actor_id
  where championship.id = target_id;

  return jsonb_build_object(
    'championshipId', target_id,
    'batchId', v_batch_id,
    'alreadyImported', false,
    'summary', v_preview -> 'summary'
  );
end;
$$;

revoke all on function public.admin_preview_championship_standings_import(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_apply_championship_standings_import(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_preview_championship_standings_import(uuid, jsonb) to authenticated;
grant execute on function public.admin_apply_championship_standings_import(uuid, jsonb) to authenticated;
