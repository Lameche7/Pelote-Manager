create table if not exists public.championship_general_standings (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.championship_divisions(id) on delete cascade,
  pool_id uuid references public.championship_pools(id) on delete set null,
  team_id uuid not null references public.championship_teams(id) on delete cascade,
  rank integer not null check (rank > 0),
  pool_rank integer check (pool_rank is null or pool_rank > 0),
  played integer,
  wins integer,
  draws integer,
  losses integer,
  points numeric,
  score_for integer,
  score_against integer,
  score_difference integer,
  source_payload jsonb not null default '{}'::jsonb,
  source_import_file_id uuid references public.championship_import_files(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (division_id, team_id),
  unique (division_id, rank)
);

create index if not exists championship_general_standings_division_rank_idx
  on public.championship_general_standings (division_id, rank);

alter table public.championship_general_standings enable row level security;
revoke all on table public.championship_general_standings from anon, authenticated;

create or replace function public.admin_preview_championship_rankings_import(
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
  v_pool_preview jsonb;
  v_pool_incoming jsonb := payload -> 'standings';
  v_general_incoming jsonb := payload -> 'generalStandings';
  v_general_issues jsonb := '[]'::jsonb;
  v_item jsonb;
  v_division_id uuid;
  v_pool_id uuid;
  v_team_id uuid;
  v_division_normalized text;
  v_pool_code text;
  v_club_normalized text;
  v_team_number text;
  v_team_label text;
  v_rank integer;
  v_pool_rank integer;
  v_seen_teams jsonb := '{}'::jsonb;
  v_seen_ranks jsonb := '{}'::jsonb;
  v_team_key text;
  v_rank_key text;
  v_missing_general_count integer := 0;
  v_general_new_count integer := 0;
  v_general_changed_count integer := 0;
  v_general_unchanged_count integer := 0;
  v_existing_rank integer;
begin
  v_pool_preview := public.admin_preview_championship_standings_import(target_id, payload);

  if jsonb_typeof(v_general_incoming) <> 'array'
     or jsonb_array_length(v_general_incoming) = 0 then
    v_general_issues := v_general_issues || jsonb_build_array(jsonb_build_object(
      'code', 'general_standings_missing',
      'message', 'Le classement général officiel à l’issue des poules est absent.'
    ));
  else
    for v_item in select value from jsonb_array_elements(v_general_incoming)
    loop
      v_division_normalized := nullif(btrim(v_item ->> 'divisionNormalized'), '');
      v_pool_code := nullif(btrim(v_item ->> 'poolCode'), '');
      v_club_normalized := nullif(btrim(v_item ->> 'clubNormalized'), '');
      v_team_number := nullif(btrim(v_item ->> 'teamNumber'), '');
      v_team_label := coalesce(nullif(btrim(v_item ->> 'teamLabel'), ''), 'Équipe inconnue');
      v_rank := nullif(v_item ->> 'rank', '')::integer;
      v_pool_rank := nullif(v_item ->> 'poolRank', '')::integer;

      if v_division_normalized is null or v_pool_code is null
         or v_club_normalized is null or v_team_number is null
         or v_rank is null or v_rank <= 0
         or v_pool_rank is null or v_pool_rank <= 0 then
        v_general_issues := v_general_issues || jsonb_build_array(jsonb_build_object(
          'code', 'invalid_general_row',
          'message', format('Ligne de classement général incomplète pour %s.', v_team_label)
        ));
        continue;
      end if;

      select division.id into v_division_id
      from public.championship_divisions as division
      where division.championship_id = target_id
        and division.normalized_name = v_division_normalized
      limit 1;

      select pool.id into v_pool_id
      from public.championship_pools as pool
      where pool.division_id = v_division_id and pool.code = v_pool_code
      limit 1;

      select team.id into v_team_id
      from public.championship_teams as team
      join public.championship_federation_clubs as federation_club
        on federation_club.id = team.federation_club_id
      where team.division_id = v_division_id
        and team.pool_id = v_pool_id
        and team.team_number = v_team_number
        and federation_club.normalized_name = v_club_normalized
      limit 1;

      if v_division_id is null or v_pool_id is null or v_team_id is null then
        v_general_issues := v_general_issues || jsonb_build_array(jsonb_build_object(
          'code', 'general_team_not_found',
          'message', format('Équipe officielle introuvable dans le classement général : %s.', v_team_label)
        ));
        continue;
      end if;

      if not exists (
        select 1 from jsonb_array_elements(coalesce(v_pool_incoming, '[]'::jsonb)) as pool_row(value)
        where pool_row.value ->> 'divisionNormalized' = v_division_normalized
          and pool_row.value ->> 'poolCode' = v_pool_code
          and pool_row.value ->> 'clubNormalized' = v_club_normalized
          and pool_row.value ->> 'teamNumber' = v_team_number
      ) then
        v_general_issues := v_general_issues || jsonb_build_array(jsonb_build_object(
          'code', 'general_team_not_ranked_in_pool',
          'message', format('%s apparaît au général mais pas dans le classement de sa poule.', v_team_label)
        ));
        continue;
      end if;

      v_team_key := v_division_id::text || ':' || v_team_id::text;
      v_rank_key := v_division_id::text || ':' || v_rank::text;
      if v_seen_teams ? v_team_key or v_seen_ranks ? v_rank_key then
        v_general_issues := v_general_issues || jsonb_build_array(jsonb_build_object(
          'code', 'duplicate_general_row',
          'message', format('Doublon dans le classement général près de %s.', v_team_label)
        ));
        continue;
      end if;
      v_seen_teams := v_seen_teams || jsonb_build_object(v_team_key, true);
      v_seen_ranks := v_seen_ranks || jsonb_build_object(v_rank_key, true);

      select standing.rank into v_existing_rank
      from public.championship_general_standings as standing
      where standing.division_id = v_division_id and standing.team_id = v_team_id;
      if not found then
        v_general_new_count := v_general_new_count + 1;
      elsif v_existing_rank is distinct from v_rank then
        v_general_changed_count := v_general_changed_count + 1;
      else
        v_general_unchanged_count := v_general_unchanged_count + 1;
      end if;
    end loop;

    select count(*)::integer into v_missing_general_count
    from jsonb_array_elements(coalesce(v_pool_incoming, '[]'::jsonb)) as pool_row(value)
    where not exists (
      select 1 from jsonb_array_elements(v_general_incoming) as general_row(value)
      where general_row.value ->> 'divisionNormalized' = pool_row.value ->> 'divisionNormalized'
        and general_row.value ->> 'poolCode' = pool_row.value ->> 'poolCode'
        and general_row.value ->> 'clubNormalized' = pool_row.value ->> 'clubNormalized'
        and general_row.value ->> 'teamNumber' = pool_row.value ->> 'teamNumber'
    );
    if v_missing_general_count > 0 then
      v_general_issues := v_general_issues || jsonb_build_array(jsonb_build_object(
        'code', 'incomplete_general_standings',
        'message', format('Le classement général est incomplet : %s équipe(s) classée(s) dans les poules n’y figurent pas.', v_missing_general_count)
      ));
    end if;
  end if;

  return jsonb_build_object(
    'valid', coalesce((v_pool_preview ->> 'valid')::boolean, false) and jsonb_array_length(v_general_issues) = 0,
    'alreadyImported', coalesce((v_pool_preview ->> 'alreadyImported')::boolean, false),
    'batchId', v_pool_preview -> 'batchId',
    'summary', v_pool_preview -> 'summary',
    'generalSummary', jsonb_build_object(
      'incomingCount', coalesce(jsonb_array_length(v_general_incoming), 0),
      'newCount', v_general_new_count,
      'changedCount', v_general_changed_count,
      'unchangedCount', v_general_unchanged_count
    ),
    'changes', coalesce(v_pool_preview -> 'changes', '[]'::jsonb),
    'issues', coalesce(v_pool_preview -> 'issues', '[]'::jsonb) || v_general_issues
  );
end;
$$;

create or replace function public.admin_apply_championship_rankings_import(
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
  v_pool_result jsonb;
  v_general_incoming jsonb := payload -> 'generalStandings';
  v_batch_id uuid;
  v_import_file_id uuid;
  v_item jsonb;
  v_division_id uuid;
  v_pool_id uuid;
  v_team_id uuid;
  v_touched_division_id uuid;
begin
  if not public.championship_club_can_manage(target_id, v_target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  v_preview := public.admin_preview_championship_rankings_import(target_id, payload);
  if not coalesce((v_preview ->> 'valid')::boolean, false) then
    raise exception 'Championship rankings import is invalid';
  end if;

  v_pool_result := public.admin_apply_championship_standings_import(target_id, payload);
  v_batch_id := nullif(v_pool_result ->> 'batchId', '')::uuid;
  if coalesce((v_pool_result ->> 'alreadyImported')::boolean, false) then
    return jsonb_build_object('championshipId', target_id, 'batchId', v_batch_id,
      'alreadyImported', true, 'summary', v_pool_result -> 'summary',
      'generalSummary', v_preview -> 'generalSummary');
  end if;

  select source_file.id into v_import_file_id
  from public.championship_import_files as source_file
  where source_file.batch_id = v_batch_id and source_file.kind = 'standings'
  order by source_file.created_at desc limit 1;

  for v_touched_division_id in
    select distinct division.id
    from jsonb_array_elements(v_general_incoming) as source_row(value)
    join public.championship_divisions as division
      on division.championship_id = target_id
     and division.normalized_name = source_row.value ->> 'divisionNormalized'
  loop
    delete from public.championship_general_standings as standing
    where standing.division_id = v_touched_division_id;
  end loop;

  for v_item in select value from jsonb_array_elements(v_general_incoming)
  loop
    select division.id into v_division_id from public.championship_divisions as division
    where division.championship_id = target_id and division.normalized_name = v_item ->> 'divisionNormalized' limit 1;
    select pool.id into v_pool_id from public.championship_pools as pool
    where pool.division_id = v_division_id and pool.code = v_item ->> 'poolCode' limit 1;
    select team.id into v_team_id
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club on federation_club.id = team.federation_club_id
    where team.division_id = v_division_id and team.pool_id = v_pool_id
      and team.team_number = v_item ->> 'teamNumber'
      and federation_club.normalized_name = v_item ->> 'clubNormalized' limit 1;

    insert into public.championship_general_standings (
      division_id, pool_id, team_id, rank, pool_rank, played, wins, draws, losses, points,
      score_for, score_against, score_difference, source_payload, source_import_file_id, updated_at
    ) values (
      v_division_id, v_pool_id, v_team_id,
      nullif(v_item ->> 'rank', '')::integer,
      nullif(v_item ->> 'poolRank', '')::integer,
      nullif(v_item ->> 'played', '')::integer,
      nullif(v_item ->> 'wins', '')::integer,
      nullif(v_item ->> 'draws', '')::integer,
      nullif(v_item ->> 'losses', '')::integer,
      nullif(v_item ->> 'points', '')::numeric,
      nullif(v_item ->> 'scoreFor', '')::integer,
      nullif(v_item ->> 'scoreAgainst', '')::integer,
      nullif(v_item ->> 'scoreDifference', '')::integer,
      coalesce(v_item -> 'sourcePayload', '{}'::jsonb), v_import_file_id, now()
    );
  end loop;

  update public.championship_import_batches as batch
  set summary = coalesce(batch.summary, '{}'::jsonb) || jsonb_build_object('general', v_preview -> 'generalSummary')
  where batch.id = v_batch_id;
  insert into public.championship_audit_log (championship_id, club_id, actor_id, action, payload)
  values (target_id, v_target_club_id, v_actor_id, 'general_standings.imported',
    jsonb_build_object('batchId', v_batch_id, 'summary', v_preview -> 'generalSummary'));

  return jsonb_build_object('championshipId', target_id, 'batchId', v_batch_id,
    'alreadyImported', false, 'summary', v_pool_result -> 'summary',
    'generalSummary', v_preview -> 'generalSummary');
end;
$$;

revoke all on function public.admin_preview_championship_rankings_import(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_apply_championship_rankings_import(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_preview_championship_rankings_import(uuid, jsonb) to authenticated;
grant execute on function public.admin_apply_championship_rankings_import(uuid, jsonb) to authenticated;
