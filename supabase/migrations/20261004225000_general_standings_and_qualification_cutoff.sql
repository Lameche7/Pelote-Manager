alter table public.championship_divisions
  add column if not exists qualification_cutoff integer,
  add column if not exists qualification_source text,
  add column if not exists qualification_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'championship_divisions_qualification_cutoff_check'
      and conrelid = 'public.championship_divisions'::regclass
  ) then
    alter table public.championship_divisions
      add constraint championship_divisions_qualification_cutoff_check
      check (qualification_cutoff is null or qualification_cutoff > 0);
  end if;
end $$;

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
        'code', 'unknown_division', 'division', v_division_key
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

    if v_expected_count = 0
      or v_incoming_count <> v_expected_count
      or v_matched_count <> v_incoming_count
    then
      v_issue_count := v_issue_count + 1;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'incomplete_general_standings',
        'division', v_division_key,
        'expectedCount', v_expected_count,
        'incomingCount', v_incoming_count,
        'matchedCount', v_matched_count
      ));
      continue;
    end if;

    delete from public.championship_general_standings
    where division_id = v_division_id;

    insert into public.championship_general_standings (
      division_id, pool_id, team_id, rank, pool_rank,
      played, wins, draws, losses, points,
      score_for, score_against, score_difference,
      source_payload, source_import_file_id, updated_at
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
    championship_id, club_id, actor_id, action, payload
  ) values (
    target_id, v_target_club_id, v_actor_id,
    'championship.official_general_standings_synced',
    jsonb_build_object(
      'updatedCount', v_updated_count,
      'issueCount', v_issue_count,
      'issues', v_issues
    )
  );

  return jsonb_build_object(
    'updatedCount', v_updated_count,
    'issueCount', v_issue_count,
    'issues', v_issues
  );
end;
$$;

revoke all on function public.admin_sync_championship_official_general_standings(uuid, jsonb) from public, anon;
grant execute on function public.admin_sync_championship_official_general_standings(uuid, jsonb) to authenticated;

create or replace function public.list_championship_general_standings_browser(
  target_championship_id uuid
)
returns table (
  division_id uuid,
  division_name text,
  division_display_order integer,
  qualification_cutoff integer,
  qualification_source text,
  pool_id uuid,
  pool_code text,
  team_id uuid,
  team_label text,
  team_number text,
  club_name text,
  players text[],
  general_rank integer,
  pool_rank integer,
  points numeric,
  played integer,
  wins integer,
  draws integer,
  losses integer,
  score_for integer,
  score_against integer,
  score_difference integer,
  is_my_team boolean,
  is_my_division boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with my_teams as (
    select distinct team.id as team_id, team.division_id
    from public.championship_players as player
    join public.championship_team_players as team_player on team_player.player_id = player.id
    join public.championship_teams as team on team.id = team_player.team_id
    join public.championship_divisions as division on division.id = team.division_id
    where player.profile_id = auth.uid()
      and player.link_status in ('claimed', 'verified')
      and division.championship_id = target_championship_id
  ),
  team_players as (
    select team_player.team_id,
      array_agg(
        btrim(concat_ws(' ', player.first_name, player.last_name))
        order by player.last_name, player.first_name
      ) as names
    from public.championship_team_players as team_player
    join public.championship_players as player on player.id = team_player.player_id
    group by team_player.team_id
  )
  select
    division.id,
    division.name,
    division.display_order,
    division.qualification_cutoff,
    division.qualification_source,
    standing.pool_id,
    pool.code,
    team.id,
    team.source_label,
    team.team_number,
    federation_club.name,
    coalesce(team_players.names, array[]::text[]),
    standing.rank,
    standing.pool_rank,
    standing.points,
    coalesce(standing.played, 0),
    coalesce(standing.wins, 0),
    coalesce(standing.draws, 0),
    coalesce(standing.losses, 0),
    coalesce(standing.score_for, 0),
    coalesce(standing.score_against, 0),
    coalesce(standing.score_difference, 0),
    exists (select 1 from my_teams as mine where mine.team_id = team.id),
    exists (select 1 from my_teams as mine where mine.division_id = division.id)
  from public.championship_general_standings as standing
  join public.championship_divisions as division on division.id = standing.division_id
  join public.championship_teams as team on team.id = standing.team_id
  join public.championship_federation_clubs as federation_club on federation_club.id = team.federation_club_id
  left join public.championship_pools as pool on pool.id = standing.pool_id
  left join team_players on team_players.team_id = team.id
  where division.championship_id = target_championship_id
  order by division.display_order, standing.rank;
$$;

revoke all on function public.list_championship_general_standings_browser(uuid) from public, anon, authenticated;
grant execute on function public.list_championship_general_standings_browser(uuid) to authenticated;
