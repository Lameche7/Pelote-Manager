-- Series-scoped finals operations. Existing one-argument RPCs remain intact.
-- Lock the tournament row to serialize planning/publication across series.
CREATE OR REPLACE FUNCTION public.admin_generate_tournament_final_stage(target_tournament_id uuid, target_series_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  target_series public.tournament_series;
  qualifier_count integer;
  main_bracket_size integer;
  direct_count integer;
  seed_order integer[];
  seed_index integer;
  seed_a integer;
  seed_b integer;
  team_a uuid;
  team_b uuid;
  display_index integer;
  round_key text;
  inserted_count integer := 0;
  pool_match_count integer;
  validated_match_count integer;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
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

  if not exists (select 1 from public.tournament_series s where s.id = target_series_id and s.tournament_id = target_tournament.id and s.enabled) then
    raise exception 'Tournament series not found' using errcode = 'P0002';
  end if;

  if target_tournament.status not in ('planning_published', 'in_progress') then
    raise exception 'Tournament pools are not in progress or completed'
      using errcode = 'P0001';
  end if;

  if target_tournament.finals_starts_on is null
    or target_tournament.finals_ends_on is null then
    raise exception 'Tournament finals dates are missing' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.tournament_final_seeds as seed
    where seed.tournament_id = target_tournament.id
      and seed.series_id = target_series_id
  ) then
    raise exception 'Tournament final stage is already generated'
      using errcode = 'P0001';
  end if;

  for target_series in
    select series.*
    from public.tournament_series as series
    where series.tournament_id = target_tournament.id
      and series.enabled
      and series.id = target_series_id
    order by series.display_order, series.name
  loop
    qualifier_count := target_series.finals_qualifier_count;

    if qualifier_count < 2 then
      raise exception 'Tournament qualifier count is not configured for every series'
        using errcode = 'P0001';
    end if;

    select count(*)::integer
    into pool_match_count
    from public.tournament_matches as match
    where match.tournament_id = target_tournament.id
      and match.series_id = target_series.id
      and match.phase = 'pools';

    select count(*)::integer
    into validated_match_count
    from public.tournament_matches as match
    join public.tournament_match_results as result
      on result.match_id = match.id
     and result.status = 'validated'
    where match.tournament_id = target_tournament.id
      and match.series_id = target_series.id
      and match.phase = 'pools';

    if pool_match_count = 0 or validated_match_count <> pool_match_count then
      raise exception 'Every pool match must have a validated result before finals'
        using errcode = 'P0001';
    end if;

    if exists (
      select 1
      from public.tournament_general_ranking_rows(
        target_tournament.id,
        target_series.id
      ) as ranking
      where ranking.tie_first_position <= qualifier_count
        and ranking.tie_last_position > qualifier_count
    ) then
      raise exception 'Tournament qualification cutoff contains an unresolved tie'
        using errcode = 'P0001';
    end if;

    if (
      select count(*)
      from public.tournament_general_ranking_rows(
        target_tournament.id,
        target_series.id
      )
    ) < qualifier_count then
      raise exception 'Tournament does not contain enough ranked teams'
        using errcode = 'P0001';
    end if;

    insert into public.tournament_final_seeds (
      tournament_id,
      series_id,
      seed,
      team_id
    )
    select
      target_tournament.id,
      target_series.id,
      ranking.position,
      ranking.team_id
    from public.tournament_general_ranking_rows(
      target_tournament.id,
      target_series.id
    ) as ranking
    where ranking.position <= qualifier_count
    order by ranking.position;

    main_bracket_size := public.tournament_main_bracket_size(qualifier_count);
    direct_count := case
      when qualifier_count = main_bracket_size then qualifier_count
      else 2 * main_bracket_size - qualifier_count
    end;

    display_index := 0;

    if qualifier_count <> main_bracket_size then
      seed_a := direct_count + 1;
      while seed_a <= main_bracket_size
      loop
        seed_b := qualifier_count + direct_count + 1 - seed_a;

        select seed.team_id into team_a
        from public.tournament_final_seeds as seed
        where seed.tournament_id = target_tournament.id
          and seed.series_id = target_series.id
          and seed.seed = seed_a;

        select seed.team_id into team_b
        from public.tournament_final_seeds as seed
        where seed.tournament_id = target_tournament.id
          and seed.series_id = target_series.id
          and seed.seed = seed_b;

        insert into public.tournament_matches (
          tournament_id,
          pool_id,
          series_id,
          team_a_id,
          team_b_id,
          display_order,
          status,
          phase,
          final_round,
          final_round_number,
          final_seed_a,
          final_seed_b,
          updated_at
        )
        values (
          target_tournament.id,
          null,
          target_series.id,
          team_a,
          team_b,
          display_index,
          'to_schedule',
          'finals',
          'preliminary',
          0,
          seed_a,
          seed_b,
          now()
        );

        inserted_count := inserted_count + 1;
        display_index := display_index + 1;
        seed_a := seed_a + 1;
      end loop;
    else
      seed_order := public.tournament_final_seed_order(main_bracket_size);
      round_key := public.tournament_final_round_key(main_bracket_size);
      seed_index := 1;

      while seed_index <= array_length(seed_order, 1)
      loop
        seed_a := seed_order[seed_index];
        seed_b := seed_order[seed_index + 1];

        select seed.team_id into team_a
        from public.tournament_final_seeds as seed
        where seed.tournament_id = target_tournament.id
          and seed.series_id = target_series.id
          and seed.seed = seed_a;

        select seed.team_id into team_b
        from public.tournament_final_seeds as seed
        where seed.tournament_id = target_tournament.id
          and seed.series_id = target_series.id
          and seed.seed = seed_b;

        insert into public.tournament_matches (
          tournament_id,
          pool_id,
          series_id,
          team_a_id,
          team_b_id,
          display_order,
          status,
          phase,
          final_round,
          final_round_number,
          final_seed_a,
          final_seed_b,
          updated_at
        )
        values (
          target_tournament.id,
          null,
          target_series.id,
          team_a,
          team_b,
          display_index,
          'to_schedule',
          'finals',
          round_key,
          1,
          seed_a,
          seed_b,
          now()
        );

        inserted_count := inserted_count + 1;
        display_index := display_index + 1;
        seed_index := seed_index + 2;
      end loop;
    end if;
  end loop;

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
    'final_stage_generated',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object('matches_created', inserted_count),
    auth.uid()
  );

  return inserted_count;
end;
$function$;


CREATE OR REPLACE FUNCTION public.admin_publish_tournament_final_round(target_tournament_id uuid, target_series_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  tournament_event_type_id uuid;
  item record;
  target_event_id uuid;
  published_count integer := 0;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.* into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.tournament_series s where s.id = target_series_id and s.tournament_id = target_tournament.id and s.enabled) then
    raise exception 'Tournament series not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.tournament_matches as match
    where match.tournament_id = target_tournament.id
      and match.series_id = target_series_id
      and match.phase = 'finals'
      and match.final_round_number = (
        select max(current_match.final_round_number)
        from public.tournament_matches as current_match
        where current_match.tournament_id = match.tournament_id
          and current_match.series_id = match.series_id
          and current_match.phase = 'finals'
      )
      and not exists (
        select 1 from public.tournament_match_results as result
        where result.match_id = match.id and result.status = 'validated'
      )
      and not exists (
        select 1 from public.tournament_match_planning as planning
        where planning.match_id = match.id
      )
  ) then
    raise exception 'Every current finals match must be planned before publication'
      using errcode = 'P0001';
  end if;

  -- Contrôle des conflits au dernier moment, juste avant la projection calendrier.
  if exists (
    select 1
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    join public.reservable_resources as resource on resource.id = planning.resource_id
    join public.calendar_occupations as occupation
      on occupation.resource_id = planning.resource_id
     and occupation.cancelled_at is null
     and occupation.starts_at < public.tournament_planning_starts_at(
       planning.play_date, planning.ends_at, resource.timezone
     )
     and occupation.ends_at > public.tournament_planning_starts_at(
       planning.play_date, planning.starts_at, resource.timezone
     )
    where match.tournament_id = target_tournament.id
      and match.series_id = target_series_id
      and match.phase = 'finals'
      and not exists (
        select 1 from public.tournament_match_events as own_link
        where own_link.match_id = match.id
      )
  ) then
    raise exception 'Tournament finals publication conflicts with calendar'
      using errcode = '23P01';
  end if;

  select event_type.id into tournament_event_type_id
  from public.event_types as event_type
  where event_type.club_id = target_club_id
    and lower(event_type.name) = lower('Tournoi')
  order by event_type.display_order, event_type.id
  limit 1;

  if tournament_event_type_id is null then
    insert into public.event_types (club_id, name, color, icon, display_order)
    values (target_club_id, 'Tournoi', '#DC2626', 'trophy', 10)
    returning id into tournament_event_type_id;
  end if;

  for item in
    select
      match.id as match_id,
      match.final_round,
      match.team_a_id,
      match.team_b_id,
      series.name as series_name,
      series.color as series_color,
      planning.resource_id,
      resource.timezone as resource_timezone,
      planning.play_date,
      planning.starts_at,
      planning.ends_at
    from public.tournament_matches as match
    join public.tournament_series as series on series.id = match.series_id
    join public.tournament_match_planning as planning on planning.match_id = match.id
    join public.reservable_resources as resource on resource.id = planning.resource_id
    where match.tournament_id = target_tournament.id
      and match.series_id = target_series_id
      and match.phase = 'finals'
      and not exists (
        select 1 from public.tournament_match_events as event_link
        where event_link.match_id = match.id
      )
      and not exists (
        select 1 from public.tournament_match_results as result
        where result.match_id = match.id and result.status = 'validated'
      )
    order by planning.play_date, planning.starts_at, series.display_order, match.display_order
  loop
    insert into public.events (
      club_id, event_type_id, name, description, color,
      starts_at, ends_at, is_blocking, visibility, publication_status,
      registration_required, created_by, updated_by
    ) values (
      target_club_id,
      tournament_event_type_id,
      concat(
        item.series_name,
        ' · ',
        public.tournament_team_public_label(item.team_a_id),
        ' — ',
        public.tournament_team_public_label(item.team_b_id)
      ),
      concat(target_tournament.name, ' · Phase finale · ', item.final_round),
      item.series_color,
      public.tournament_planning_starts_at(item.play_date, item.starts_at, item.resource_timezone),
      public.tournament_planning_starts_at(item.play_date, item.ends_at, item.resource_timezone),
      true,
      'public',
      'published',
      false,
      auth.uid(),
      auth.uid()
    ) returning id into target_event_id;

    insert into public.event_resources (event_id, resource_id)
    values (target_event_id, item.resource_id);

    insert into public.tournament_match_events (match_id, event_id)
    values (item.match_id, target_event_id);

    perform public.sync_event_occupations(target_event_id);

    insert into public.event_audit_log (
      club_id, event_id, action, actor_id, previous_data, new_data
    )
    select
      target_club_id,
      target_event_id,
      'created',
      auth.uid(),
      null,
      to_jsonb(event) || jsonb_build_object('resource_ids', jsonb_build_array(item.resource_id))
    from public.events as event
    where event.id = target_event_id;

    published_count := published_count + 1;
  end loop;

  if published_count > 0 then
    insert into public.tournament_audit_log (
      tournament_id, action, before_status, after_status, payload, created_by
    ) values (
      target_tournament.id,
      'final_round_published',
      target_tournament.status,
      target_tournament.status,
      jsonb_build_object('matches_published', published_count),
      auth.uid()
    );
  end if;

  return published_count;
end;
$function$;


revoke all on function public.admin_generate_tournament_final_stage(uuid,uuid) from public,anon;
revoke all on function public.admin_publish_tournament_final_round(uuid,uuid) from public,anon;
grant execute on function public.admin_generate_tournament_final_stage(uuid,uuid) to authenticated;
grant execute on function public.admin_publish_tournament_final_round(uuid,uuid) to authenticated;
