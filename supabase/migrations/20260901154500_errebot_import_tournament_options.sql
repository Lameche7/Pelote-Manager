begin;

-- PR125 — l'import Errebot ne doit jamais hériter silencieusement des règles
-- sportives par défaut. Cette couche configure explicitement les règles, les
-- terrains et la durée des créneaux après l'import transactionnel natif.
-- Elle fonctionne aussi sur un fichier déjà importé afin de corriger un tournoi
-- Errebot existant sans le dupliquer.

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
  target_profile_id uuid := auth.uid();
  input_tournament jsonb := coalesce(payload->'tournament', '{}'::jsonb);
  input_rules jsonb := coalesce(payload->'sportingRules', '{}'::jsonb);
  input_resource_ids jsonb := coalesce(input_tournament->'resourceIds', '[]'::jsonb);
  input_primary_resource_id uuid := nullif(input_tournament->>'primaryResourceId', '')::uuid;
  input_slot_duration integer := coalesce(
    nullif(input_tournament->>'slotDurationMinutes', '')::integer,
    0
  );
  input_match_format text := btrim(coalesce(input_rules->>'matchFormat', ''));
  input_single_game_points integer := coalesce(
    nullif(input_rules->>'singleGamePoints', '')::integer,
    0
  );
  input_main_set_points integer := coalesce(
    nullif(input_rules->>'mainSetPoints', '')::integer,
    0
  );
  input_deciding_set_points integer := coalesce(
    nullif(input_rules->>'decidingSetPoints', '')::integer,
    0
  );
  input_base_win_points integer := coalesce(
    nullif(input_rules->>'baseWinPoints', '')::integer,
    -1
  );
  input_base_loss_points integer := coalesce(
    nullif(input_rules->>'baseLossPoints', '')::integer,
    -1
  );
  input_offensive_bonus_points integer := coalesce(
    nullif(input_rules->>'offensiveBonusPoints', '')::integer,
    -1
  );
  input_defensive_bonus_points integer := coalesce(
    nullif(input_rules->>'defensiveBonusPoints', '')::integer,
    -1
  );
  input_offensive_bonus_margin integer := coalesce(
    nullif(input_rules->>'offensiveBonusMargin', '')::integer,
    0
  );
  input_defensive_bonus_margin integer := coalesce(
    nullif(input_rules->>'defensiveBonusMargin', '')::integer,
    0
  );
  input_ranking_mode text := btrim(coalesce(input_rules->>'rankingMode', ''));
  input_goal_average_mode text := btrim(coalesce(input_rules->>'goalAverageMode', ''));
  resource_count integer;
  distinct_resource_count integer;
  import_result jsonb;
  legacy_payload jsonb;
  target_tournament_id uuid;
  target_import_id uuid;
  target_tournament public.tournaments;
begin
  if target_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(input_resource_ids) <> 'array' then
    raise exception 'Errebot tournament resources are invalid'
      using errcode = '22023';
  end if;

  resource_count := jsonb_array_length(input_resource_ids);

  if resource_count < 1
    or resource_count > 20
    or input_primary_resource_id is null
    or input_slot_duration < 15
    or input_slot_duration > 240 then
    raise exception 'Errebot tournament resources are invalid'
      using errcode = '22023';
  end if;

  select count(distinct resource_id)::integer
  into distinct_resource_count
  from (
    select value::uuid as resource_id
    from jsonb_array_elements_text(input_resource_ids) as resource_item(value)
  ) as selected_resources;

  if distinct_resource_count <> resource_count
    or not exists (
      select 1
      from jsonb_array_elements_text(input_resource_ids) as resource_item(value)
      where resource_item.value::uuid = input_primary_resource_id
    )
    or (
      select count(*)
      from public.reservable_resources as resource
      where resource.club_id = target_club_id
        and resource.is_active
        and resource.id in (
          select value::uuid
          from jsonb_array_elements_text(input_resource_ids) as resource_item(value)
        )
    ) <> resource_count then
    raise exception 'Errebot tournament resources are invalid'
      using errcode = '22023';
  end if;

  if input_match_format not in ('single_game', 'best_of_three_sets')
    or input_single_game_points < 1
    or input_main_set_points < 1
    or input_deciding_set_points < 1
    or input_base_win_points < 0
    or input_base_loss_points < 0
    or input_offensive_bonus_points < 0
    or input_defensive_bonus_points < 0
    or input_offensive_bonus_margin < 1
    or input_defensive_bonus_margin < 1
    or input_ranking_mode not in ('total_points', 'points_per_match')
    or input_goal_average_mode not in (
      'point_difference',
      'point_difference_per_match'
    ) then
    raise exception 'Errebot tournament sporting rules are invalid'
      using errcode = '22023';
  end if;

  -- Le moteur historique attend encore resourceId. Le terrain principal choisi
  -- explicitement devient donc le terrain du planning source Errebot.
  legacy_payload := jsonb_set(
    payload,
    '{tournament,resourceId}',
    to_jsonb(input_primary_resource_id::text),
    true
  );

  import_result := public.admin_import_errebot_tournament(legacy_payload);
  target_tournament_id := nullif(import_result->>'tournamentId', '')::uuid;

  if target_tournament_id is null then
    raise exception 'Errebot import returned no tournament'
      using errcode = 'P0001';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  select import_row.id
  into target_import_id
  from public.tournament_imports as import_row
  where import_row.tournament_id = target_tournament.id
    and import_row.club_id = target_club_id
    and import_row.source = 'errebot'
    and import_row.status = 'imported'
  order by import_row.imported_at desc nulls last, import_row.created_at desc
  limit 1
  for update;

  if target_import_id is null then
    raise exception 'Tournament is not an imported Errebot tournament'
      using errcode = 'P0001';
  end if;

  -- Les options restent corrigeables tant que le planning n'a pas été publié.
  -- Les scores source Errebot ne sont pas des résultats natifs et n'empêchent pas
  -- cette correction.
  if target_tournament.status <> 'planning_generated' then
    raise exception 'Imported Errebot tournament options are locked after publication'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.tournament_match_planning as planning
    where planning.tournament_id = target_tournament.id
      and ((planning.starts_at + make_interval(mins => input_slot_duration))::time)
        <= planning.starts_at
  ) then
    raise exception 'Errebot fixture duration crosses midnight'
      using errcode = '22023';
  end if;

  update public.tournament_sporting_rules
  set
    match_format = input_match_format::public.tournament_match_format,
    single_game_points = input_single_game_points,
    main_set_points = input_main_set_points,
    deciding_set_points = input_deciding_set_points,
    base_win_points = input_base_win_points,
    base_loss_points = input_base_loss_points,
    offensive_bonus_points = input_offensive_bonus_points,
    defensive_bonus_points = input_defensive_bonus_points,
    offensive_bonus_margin = input_offensive_bonus_margin,
    defensive_bonus_margin = input_defensive_bonus_margin,
    ranking_mode = input_ranking_mode::public.tournament_ranking_mode,
    goal_average_mode = input_goal_average_mode::public.tournament_goal_average_mode,
    updated_at = now()
  where tournament_id = target_tournament.id;

  delete from public.tournament_resources
  where tournament_id = target_tournament.id;

  insert into public.tournament_resources (
    tournament_id,
    resource_id,
    display_order
  )
  select
    target_tournament.id,
    resource_item.value::uuid,
    (resource_item.ordinality - 1)::integer
  from jsonb_array_elements_text(input_resource_ids)
    with ordinality as resource_item(value, ordinality);

  -- L'export Errebot ne porte pas d'identifiant de terrain par rencontre. Tous
  -- les matchs du planning source utilisent donc le terrain principal choisi.
  update public.tournament_match_planning
  set
    resource_id = input_primary_resource_id,
    ends_at = (starts_at + make_interval(mins => input_slot_duration))::time,
    updated_at = now()
  where tournament_id = target_tournament.id;

  update public.tournaments
  set
    slot_duration_minutes = input_slot_duration,
    updated_by = target_profile_id,
    updated_at = now()
  where id = target_tournament.id;

  -- Recalcule les fenêtres natives à partir du planning réellement importé.
  delete from public.tournament_play_windows
  where tournament_id = target_tournament.id;

  insert into public.tournament_play_windows (
    tournament_id,
    weekday,
    opens_at,
    closes_at,
    display_order
  )
  select
    target_tournament.id,
    source_slot.weekday,
    source_slot.starts_at,
    source_slot.ends_at,
    row_number() over (
      order by source_slot.weekday, source_slot.starts_at, source_slot.ends_at
    )::integer - 1
  from (
    select distinct
      extract(dow from planning.play_date)::smallint as weekday,
      planning.starts_at,
      planning.ends_at
    from public.tournament_match_planning as planning
    where planning.tournament_id = target_tournament.id
  ) as source_slot
  order by source_slot.weekday, source_slot.starts_at, source_slot.ends_at;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament.id,
    'errebot_options_configured',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'import_id', target_import_id,
      'primary_resource_id', input_primary_resource_id,
      'resource_ids', input_resource_ids,
      'slot_duration_minutes', input_slot_duration,
      'sporting_rules', input_rules
    ),
    target_profile_id
  );

  return import_result || jsonb_build_object(
    'optionsApplied', true,
    'primaryResourceId', input_primary_resource_id,
    'resourceCount', resource_count,
    'matchFormat', input_match_format,
    'slotDurationMinutes', input_slot_duration
  );
end;
$$;

revoke all on function public.admin_import_errebot_tournament_configured(jsonb)
from public, anon, authenticated;
grant execute on function public.admin_import_errebot_tournament_configured(jsonb)
to authenticated;

commit;
