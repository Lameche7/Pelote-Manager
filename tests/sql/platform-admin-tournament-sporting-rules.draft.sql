-- Draft: club-scoped sporting rules, preserving local administrator RPCs.

create or replace function public.platform_admin_get_tournament_sporting_rules(
  target_club_id uuid,
  target_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'tournament_id', rules.tournament_id,
    'match_format', rules.match_format,
    'single_game_points', rules.single_game_points,
    'main_set_points', rules.main_set_points,
    'deciding_set_points', rules.deciding_set_points,
    'base_win_points', rules.base_win_points,
    'base_loss_points', rules.base_loss_points,
    'offensive_bonus_points', rules.offensive_bonus_points,
    'defensive_bonus_points', rules.defensive_bonus_points,
    'offensive_bonus_margin', rules.offensive_bonus_margin,
    'defensive_bonus_margin', rules.defensive_bonus_margin,
    'ranking_mode', rules.ranking_mode,
    'goal_average_mode', rules.goal_average_mode,
    'updated_at', rules.updated_at
  )
  into result
  from public.tournament_sporting_rules as rules
  join public.tournaments as tournament
    on tournament.id = rules.tournament_id
  where rules.tournament_id = target_id
    and tournament.club_id = target_club_id;

  if result is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke all on function public.platform_admin_get_tournament_sporting_rules(uuid, uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_get_tournament_sporting_rules(uuid, uuid) to authenticated;

create or replace function public.platform_admin_save_tournament_sporting_rules(
  target_club_id uuid,
  target_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
  previous_rules public.tournament_sporting_rules;
  saved_rules public.tournament_sporting_rules;
  target_match_format public.tournament_match_format :=
    coalesce(nullif(payload->>'match_format', ''), 'best_of_three_sets')::public.tournament_match_format;
  target_single_game_points integer :=
    coalesce(nullif(payload->>'single_game_points', '')::integer, 35);
  target_main_set_points integer :=
    coalesce(nullif(payload->>'main_set_points', '')::integer, 20);
  target_deciding_set_points integer :=
    coalesce(nullif(payload->>'deciding_set_points', '')::integer, 10);
  target_base_win_points integer :=
    coalesce(nullif(payload->>'base_win_points', '')::integer, 3);
  target_base_loss_points integer :=
    coalesce(nullif(payload->>'base_loss_points', '')::integer, 1);
  target_offensive_bonus_points integer :=
    coalesce(nullif(payload->>'offensive_bonus_points', '')::integer, 1);
  target_defensive_bonus_points integer :=
    coalesce(nullif(payload->>'defensive_bonus_points', '')::integer, 1);
  target_offensive_bonus_margin integer :=
    coalesce(nullif(payload->>'offensive_bonus_margin', '')::integer, 10);
  target_defensive_bonus_margin integer :=
    coalesce(nullif(payload->>'defensive_bonus_margin', '')::integer, 5);
  target_ranking_mode public.tournament_ranking_mode :=
    coalesce(nullif(payload->>'ranking_mode', ''), 'points_per_match')::public.tournament_ranking_mode;
  target_goal_average_mode public.tournament_goal_average_mode :=
    coalesce(nullif(payload->>'goal_average_mode', ''), 'point_difference_per_match')::public.tournament_goal_average_mode;
begin
  if auth.uid() is null or target_club_id is null
    or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  -- Les règles sportives restent modifiables tant que les poules ne sont pas
  -- validées. Une fois la compétition sportive figée, elles deviennent stables.
  if target_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed',
    'pools_generated'
  ) then
    raise exception 'Tournament sporting rules are locked at this stage'
      using errcode = 'P0001';
  end if;

  if target_single_game_points < 1
    or target_main_set_points < 1
    or target_deciding_set_points < 1
    or target_base_win_points < 0
    or target_base_loss_points < 0
    or target_offensive_bonus_points < 0
    or target_defensive_bonus_points < 0
    or target_offensive_bonus_margin < 1
    or target_defensive_bonus_margin < 1 then
    raise exception 'Tournament sporting rules are invalid'
      using errcode = '22023';
  end if;

  select rules.*
  into previous_rules
  from public.tournament_sporting_rules as rules
  where rules.tournament_id = target_tournament.id
  for update;

  insert into public.tournament_sporting_rules (
    tournament_id,
    match_format,
    single_game_points,
    main_set_points,
    deciding_set_points,
    base_win_points,
    base_loss_points,
    offensive_bonus_points,
    defensive_bonus_points,
    offensive_bonus_margin,
    defensive_bonus_margin,
    ranking_mode,
    goal_average_mode,
    updated_at
  )
  values (
    target_tournament.id,
    target_match_format,
    target_single_game_points,
    target_main_set_points,
    target_deciding_set_points,
    target_base_win_points,
    target_base_loss_points,
    target_offensive_bonus_points,
    target_defensive_bonus_points,
    target_offensive_bonus_margin,
    target_defensive_bonus_margin,
    target_ranking_mode,
    target_goal_average_mode,
    now()
  )
  on conflict (tournament_id) do update
  set
    match_format = excluded.match_format,
    single_game_points = excluded.single_game_points,
    main_set_points = excluded.main_set_points,
    deciding_set_points = excluded.deciding_set_points,
    base_win_points = excluded.base_win_points,
    base_loss_points = excluded.base_loss_points,
    offensive_bonus_points = excluded.offensive_bonus_points,
    defensive_bonus_points = excluded.defensive_bonus_points,
    offensive_bonus_margin = excluded.offensive_bonus_margin,
    defensive_bonus_margin = excluded.defensive_bonus_margin,
    ranking_mode = excluded.ranking_mode,
    goal_average_mode = excluded.goal_average_mode,
    updated_at = now()
  returning * into saved_rules;

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
    'sporting_rules_updated',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'previous', case
        when previous_rules.tournament_id is null then null
        else to_jsonb(previous_rules)
      end,
      'current', to_jsonb(saved_rules)
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.platform_admin_save_tournament_sporting_rules(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.platform_admin_save_tournament_sporting_rules(uuid, uuid, jsonb) to authenticated;

