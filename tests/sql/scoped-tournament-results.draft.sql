-- Explicit club scope; legacy endpoints remain unchanged.
-- A current local permission or a server-issued lease is required.
CREATE OR REPLACE FUNCTION public.admin_get_tournament_results_workspace_for_club(target_club_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', tournament.id,
        'name', tournament.name,
        'status', tournament.status,
        'sporting_rules', jsonb_build_object(
          'match_format', rules.match_format,
          'single_game_points', rules.single_game_points,
          'main_set_points', rules.main_set_points,
          'deciding_set_points', rules.deciding_set_points
        ),
        'matches', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', match.id,
                'play_date', planning.play_date,
                'starts_at', planning.starts_at,
                'ends_at', planning.ends_at,
                'resource_name', resource.name,
                'series_name', series.name,
                'phase', match.phase,
                'final_round', match.final_round,
                'pool_number', case
                  when match.phase = 'pools' then pool.display_order + 1
                  else null
                end,
                'team_a_label', public.tournament_team_public_label(match.team_a_id),
                'team_b_label', public.tournament_team_public_label(match.team_b_id),
                'result', case when result.id is null then null else jsonb_build_object(
                  'id', result.id,
                  'status', result.status,
                  'score', result.score,
                  'team_a_sets', result.team_a_sets,
                  'team_b_sets', result.team_b_sets,
                  'team_a_points', result.team_a_points,
                  'team_b_points', result.team_b_points,
                  'team_a_ranking_points', result.team_a_ranking_points,
                  'team_b_ranking_points', result.team_b_ranking_points,
                  'submitted_at', result.submitted_at,
                  'validated_at', result.validated_at
                ) end
              )
              order by planning.play_date, planning.starts_at, resource.name, match.id
            ),
            '[]'::jsonb
          )
          from public.tournament_matches as match
          join public.tournament_match_planning as planning on planning.match_id = match.id
          join public.reservable_resources as resource on resource.id = planning.resource_id
          join public.tournament_series as series on series.id = match.series_id
          left join public.tournament_pools as pool on pool.id = match.pool_id
          left join public.tournament_match_results as result on result.match_id = match.id
          where match.tournament_id = tournament.id
        )
      )
      order by tournament.starts_on desc, tournament.name
    ),
    '[]'::jsonb
  )
  from public.tournaments as tournament
  join public.tournament_sporting_rules as rules on rules.tournament_id = tournament.id
  where tournament.club_id = target_club_id
    and (auth.uid() is not null and target_club_id is not null and (public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)))
    and tournament.status in (
      'planning_published',
      'in_progress',
      'completed',
      'archived'
    );
$function$;
revoke all on function public.admin_get_tournament_results_workspace_for_club(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_tournament_results_workspace_for_club(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_tournament_match_result_for_club(target_club_id uuid, target_match_id uuid, score_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_match public.tournament_matches;
  target_tournament public.tournaments;
  previous_result public.tournament_match_results;
  calculated jsonb;
  saved_id uuid;
begin
  if not (auth.uid() is not null and target_club_id is not null and (public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id))) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select match.*
  into target_match
  from public.tournament_matches as match
  join public.tournaments as tournament on tournament.id = match.tournament_id
  where match.id = target_match_id
    and tournament.club_id = target_club_id
  for update of match;

  if target_match.id is null then
    raise exception 'Tournament match not found' using errcode = 'P0002';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_match.tournament_id;

  if target_tournament.status not in (
    'planning_published',
    'in_progress',
    'completed'
  ) then
    raise exception 'Tournament results are not editable at this stage'
      using errcode = 'P0001';
  end if;

  select result.*
  into previous_result
  from public.tournament_match_results as result
  where result.match_id = target_match.id
  for update;

  calculated := public.tournament_calculate_match_result(target_match.id, score_payload);

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
    target_match.id,
    target_match.tournament_id,
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
    coalesce(previous_result.submitted_at, now()),
    auth.uid(),
    now(),
    now()
  )
  on conflict (match_id) do update
  set
    status = 'validated',
    score = excluded.score,
    team_a_sets = excluded.team_a_sets,
    team_b_sets = excluded.team_b_sets,
    team_a_points = excluded.team_a_points,
    team_b_points = excluded.team_b_points,
    team_a_ranking_points = excluded.team_a_ranking_points,
    team_b_ranking_points = excluded.team_b_ranking_points,
    winner_team_id = excluded.winner_team_id,
    validated_by = auth.uid(),
    validated_at = now(),
    updated_at = now()
  returning id into saved_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_match.tournament_id,
    case when previous_result.id is null
      then 'match_result_entered_by_admin'
      else 'match_result_corrected_by_admin'
    end,
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'match_id', target_match.id,
      'result_id', saved_id,
      'previous_result', case
        when previous_result.id is null then null
        else to_jsonb(previous_result)
      end,
      'score', calculated->'score'
    ),
    auth.uid()
  );

  return saved_id;
end;
$function$;
revoke all on function public.admin_save_tournament_match_result_for_club(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_tournament_match_result_for_club(uuid, uuid, jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_validate_tournament_match_result_for_club(target_club_id uuid, target_match_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_result public.tournament_match_results;
  target_tournament public.tournaments;
begin
  if not (auth.uid() is not null and target_club_id is not null and (public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id))) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select result.*
  into target_result
  from public.tournament_match_results as result
  join public.tournaments as tournament on tournament.id = result.tournament_id
  where result.match_id = target_match_id
    and tournament.club_id = target_club_id
  for update of result;

  if target_result.id is null then
    raise exception 'Tournament result not found' using errcode = 'P0002';
  end if;

  if target_result.status <> 'pending_validation' then
    raise exception 'Tournament result is already validated' using errcode = 'P0001';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_result.tournament_id;

  update public.tournament_match_results
  set
    status = 'validated',
    validated_by = auth.uid(),
    validated_at = now(),
    updated_at = now()
  where id = target_result.id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_result.tournament_id,
    'match_result_validated',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'match_id', target_result.match_id,
      'result_id', target_result.id,
      'score', target_result.score
    ),
    auth.uid()
  );
end;
$function$;
revoke all on function public.admin_validate_tournament_match_result_for_club(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_validate_tournament_match_result_for_club(uuid, uuid) to authenticated;

