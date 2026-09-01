begin;

-- PR125 — lorsqu'un tournoi Errebot est explicitement configuré en partie
-- unique, les scores source déjà joués deviennent des résultats natifs validés.
-- On réutilise le Result Engine pour calculer vainqueur, points de classement,
-- bonus et goal-average. Les scores incompatibles ou déjà saisis n'écrasent rien.

create or replace function public.sync_errebot_single_game_results(
  target_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rules public.tournament_sporting_rules;
  source_fixture record;
  calculated jsonb;
  promoted_count integer := 0;
begin
  select sporting_rules.*
  into rules
  from public.tournament_sporting_rules as sporting_rules
  where sporting_rules.tournament_id = target_tournament_id;

  if rules.tournament_id is null
    or rules.match_format <> 'single_game' then
    return 0;
  end if;

  for source_fixture in
    select
      fixture.match_id,
      fixture.source_score_a,
      fixture.source_score_b
    from public.tournament_import_fixture_refs as fixture
    join public.tournament_imports as import_row
      on import_row.id = fixture.import_id
    join public.tournament_matches as match
      on match.id = fixture.match_id
     and match.tournament_id = target_tournament_id
    where import_row.tournament_id = target_tournament_id
      and import_row.source = 'errebot'
      and import_row.status = 'imported'
      and fixture.source_score_a is not null
      and fixture.source_score_b is not null
      and not exists (
        select 1
        from public.tournament_match_results as existing_result
        where existing_result.match_id = fixture.match_id
      )
      and (
        (
          fixture.source_score_a = rules.single_game_points
          and fixture.source_score_b < rules.single_game_points
        )
        or (
          fixture.source_score_b = rules.single_game_points
          and fixture.source_score_a < rules.single_game_points
        )
      )
    order by fixture.play_date, fixture.starts_at, fixture.match_id
  loop
    calculated := public.tournament_calculate_match_result(
      source_fixture.match_id,
      jsonb_build_object(
        'sets',
        jsonb_build_array(
          jsonb_build_object(
            'team_a', source_fixture.source_score_a,
            'team_b', source_fixture.source_score_b
          )
        )
      )
    );

    insert into public.tournament_match_results (
      match_id,
      tournament_id,
      status,
      score,
      team_a_sets,
      team_b_sets,
      team_a_points,
      team_b_points,
      team_a_ranking_points,
      team_b_ranking_points,
      winner_team_id,
      submitted_by,
      submitted_at,
      validated_by,
      validated_at,
      updated_at
    )
    values (
      source_fixture.match_id,
      target_tournament_id,
      'validated',
      calculated->'score',
      (calculated->>'team_a_sets')::integer,
      (calculated->>'team_b_sets')::integer,
      (calculated->>'team_a_points')::integer,
      (calculated->>'team_b_points')::integer,
      (calculated->>'team_a_ranking_points')::integer,
      (calculated->>'team_b_ranking_points')::integer,
      (calculated->>'winner_team_id')::uuid,
      auth.uid(),
      now(),
      auth.uid(),
      now(),
      now()
    )
    on conflict (match_id) do nothing;

    if found then
      promoted_count := promoted_count + 1;
    end if;
  end loop;

  return promoted_count;
end;
$$;

revoke all on function public.sync_errebot_single_game_results(uuid)
from public, anon, authenticated;

-- Le wrapper garde le même contrat RPC. Il sait déjà retirer temporairement un
-- planning publié avant reconfiguration ; il synchronise désormais aussi les
-- résultats source compatibles après application des règles sportives.
create or replace function public.admin_import_errebot_tournament_configured(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  input_file_hash text := lower(btrim(coalesce(payload->'file'->>'hash', '')));
  existing_tournament_id uuid;
  existing_tournament_status public.tournament_status;
  planning_was_unpublished boolean := false;
  import_result jsonb;
  result_tournament_id uuid;
  promoted_result_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if input_file_hash ~ '^[0-9a-f]{64}$' then
    select
      import_row.tournament_id,
      tournament.status
    into
      existing_tournament_id,
      existing_tournament_status
    from public.tournament_imports as import_row
    join public.tournaments as tournament
      on tournament.id = import_row.tournament_id
     and tournament.club_id = target_club_id
    where import_row.club_id = target_club_id
      and import_row.source = 'errebot'
      and import_row.source_file_hash = input_file_hash
      and import_row.status = 'imported'
      and import_row.tournament_id is not null
    order by import_row.imported_at desc nulls last, import_row.created_at desc
    limit 1
    for update of import_row, tournament;
  end if;

  if existing_tournament_id is not null then
    if existing_tournament_status = 'planning_published' then
      perform public.admin_unpublish_tournament_planning(existing_tournament_id);
      planning_was_unpublished := true;
    elsif existing_tournament_status <> 'planning_generated' then
      raise exception 'Imported Errebot tournament options are locked after publication'
        using errcode = 'P0001';
    end if;
  end if;

  import_result := public.admin_import_errebot_tournament_configured_core(payload);
  result_tournament_id := nullif(import_result->>'tournamentId', '')::uuid;

  if result_tournament_id is not null then
    promoted_result_count := public.sync_errebot_single_game_results(
      result_tournament_id
    );
  end if;

  return import_result || jsonb_build_object(
    'planningWasUnpublished', planning_was_unpublished,
    'promotedResultCount', promoted_result_count
  );
end;
$$;

revoke all on function public.admin_import_errebot_tournament_configured(jsonb)
from public, anon, authenticated;
grant execute on function public.admin_import_errebot_tournament_configured(jsonb)
to authenticated;

-- Rattrapage des tournois Errebot déjà configurés avant cette migration.
-- Les résultats natifs existants sont toujours préservés.
do $$
declare
  imported_tournament record;
begin
  for imported_tournament in
    select distinct import_row.tournament_id
    from public.tournament_imports as import_row
    join public.tournament_sporting_rules as rules
      on rules.tournament_id = import_row.tournament_id
    where import_row.source = 'errebot'
      and import_row.status = 'imported'
      and import_row.tournament_id is not null
      and rules.match_format = 'single_game'
  loop
    perform public.sync_errebot_single_game_results(
      imported_tournament.tournament_id
    );
  end loop;
end
$$;

comment on table public.tournament_import_fixture_refs is
  'Provenance privée des matchs importés. Les scores source restent conservés ; lorsqu’un tournoi est explicitement configuré en partie unique, les scores compatibles peuvent aussi être projetés en résultats natifs validés.';

commit;
