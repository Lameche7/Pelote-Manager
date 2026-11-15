-- Opt-in crossed bracket for two pools of three; all other series retain
-- their existing global-ranking bracket construction.
alter table public.tournament_series
  add column if not exists finals_cross_pools boolean not null default false;

create or replace function public.admin_get_tournament_final_cross_pools(
  target_tournament_id uuid
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare target_club uuid := public.admin_current_club_id();
begin
  if target_club is null
    or not public.has_club_permission(target_club,'tournaments.manage')
    or not exists (select 1 from public.tournaments t
                   where t.id=target_tournament_id and t.club_id=target_club) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'series_id',s.id,
      'cross_pools',s.finals_cross_pools,
      'pool_count',(select count(*) from public.tournament_pools p where p.series_id=s.id),
      'eligible',s.finals_qualifier_count=6
        and (select count(*) from public.tournament_pools p where p.series_id=s.id)=2
        and not exists(select 1 from public.tournament_pools p
          where p.series_id=s.id and
            (select count(*) from public.tournament_pool_teams pt where pt.pool_id=p.id)<>3),
      'generated',exists(select 1 from public.tournament_final_seeds seed
        where seed.tournament_id=target_tournament_id and seed.series_id=s.id)
    ) order by s.display_order)
    from public.tournament_series s
    where s.tournament_id=target_tournament_id and s.enabled
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.admin_get_tournament_final_cross_pools(uuid) from public,anon;
grant execute on function public.admin_get_tournament_final_cross_pools(uuid) to authenticated;

create or replace function public.admin_set_tournament_final_cross_pools(
  target_tournament_id uuid,
  target_series_id uuid,
  enable_cross_pools boolean
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare
  target_club uuid := public.admin_current_club_id();
  selected public.tournament_series;
  existing_bracket boolean := false;
  target_seed_order uuid[];
  seed_i integer;
  first_team uuid;
  second_team uuid;
begin
  if target_club is null or
    not public.has_club_permission(target_club,'tournaments.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  perform 1 from public.tournaments t
    where t.id=target_tournament_id and t.club_id=target_club for update;
  if not found then
    raise exception 'Tournament not found' using errcode='P0002';
  end if;
  select s.* into selected from public.tournament_series s
    where s.id=target_series_id and s.tournament_id=target_tournament_id
      and s.enabled for update;
  if selected.id is null then
    raise exception 'Tournament series not found' using errcode='P0002';
  end if;
  if selected.finals_cross_pools = enable_cross_pools then
    return enable_cross_pools;
  end if;
  existing_bracket := exists(
    select 1 from public.tournament_final_seeds seed
    where seed.tournament_id=target_tournament_id
      and seed.series_id=target_series_id
  );
  if existing_bracket and (
    exists(select 1 from public.tournament_matches m
      where m.tournament_id=target_tournament_id
        and m.series_id=target_series_id
        and m.phase='finals'
        and (m.final_round_number<>0 or m.display_order not in (0,1)))
    or (select count(*) from public.tournament_matches m
      where m.tournament_id=target_tournament_id
        and m.series_id=target_series_id and m.phase='finals') <> 2
    or exists(select 1 from public.tournament_matches m
      join public.tournament_match_results r on r.match_id=m.id
      where m.tournament_id=target_tournament_id and m.series_id=target_series_id
        and m.phase='finals')
    or exists(select 1 from public.tournament_matches m
      join public.tournament_match_events e on e.match_id=m.id
      where m.tournament_id=target_tournament_id and m.series_id=target_series_id
        and m.phase='finals')
  ) then
    raise exception 'Existing final bracket has results, publications or advanced rounds'
      using errcode='P0001';
  end if;
  if enable_cross_pools and (
      selected.finals_qualifier_count<>6
      or (select count(*) from public.tournament_pools p
          where p.series_id=target_series_id)<>2
      or exists(select 1 from public.tournament_pools p
          where p.series_id=target_series_id and
          (select count(*) from public.tournament_pool_teams pt
             where pt.pool_id=p.id)<>3)
    ) then
    raise exception 'Cross-pool bracket requires exactly two pools of three'
      using errcode='P0001';
  end if;
  if existing_bracket then
    -- Produce the full target seed order before touching any saved pairing.
    if enable_cross_pools then
      select array_agg(team_id order by desired_seed) into target_seed_order
      from (
        select
          (team.value->>'team_id')::uuid team_id,
          case (pool.value->>'number')::integer
            when 1 then case (team.value->>'position')::integer
              when 1 then 1 when 2 then 4 when 3 then 6 end
            when 2 then case (team.value->>'position')::integer
              when 1 then 2 when 2 then 3 when 3 then 5 end
          end desired_seed
        from jsonb_array_elements(
          coalesce(public.get_tournament_rankings(target_tournament_id)->'series','[]'::jsonb)
        ) serie(value)
        cross join lateral jsonb_array_elements(
          coalesce(serie.value->'pools','[]'::jsonb)
        ) pool(value)
        cross join lateral jsonb_array_elements(
          coalesce(pool.value->'teams','[]'::jsonb)
        ) team(value)
        where (serie.value->>'id')::uuid=target_series_id
      ) mapped;
    else
      select array_agg(r.team_id order by r.position)
      into target_seed_order
      from public.tournament_general_ranking_rows(
        target_tournament_id,target_series_id
      ) r where r.position<=6;
    end if;
    if cardinality(target_seed_order)<>6
      or exists(select 1 from unnest(target_seed_order) id
        where not exists(select 1 from public.tournament_final_seeds seed
          where seed.tournament_id=target_tournament_id
            and seed.series_id=target_series_id and seed.team_id=id))
    then
      raise exception 'Existing bracket and official pool standings are inconsistent'
        using errcode='P0001';
    end if;

    -- An existing MANUAL placement stays at its date and hour only when both
    -- newly paired teams explicitly declared that slot. Fail atomically otherwise.
    if exists(
      select 1 from public.tournament_matches m
      join public.tournament_match_planning mp on mp.match_id=m.id
      where m.tournament_id=target_tournament_id
        and m.series_id=target_series_id and m.phase='finals'
        and (
          not exists(select 1 from public.tournament_team_availability_slots a
            where a.tournament_id=target_tournament_id
              and a.team_id=case when m.display_order=0
                then target_seed_order[3] else target_seed_order[4] end
              and a.play_date=mp.play_date
              and a.starts_at=mp.starts_at and a.ends_at=mp.ends_at)
          or not exists(select 1 from public.tournament_team_availability_slots a
            where a.tournament_id=target_tournament_id
              and a.team_id=case when m.display_order=0
                then target_seed_order[6] else target_seed_order[5] end
              and a.play_date=mp.play_date
              and a.starts_at=mp.starts_at and a.ends_at=mp.ends_at)
        )
    ) then
      raise exception 'New cross-pool opponents are not both available for existing fixtures'
        using errcode='P0001';
    end if;

    update public.tournament_final_seeds seed set seed=seed.seed+100
      where seed.tournament_id=target_tournament_id
        and seed.series_id=target_series_id;
    for seed_i in 1..6 loop
      update public.tournament_final_seeds seed set seed=seed_i
      where seed.tournament_id=target_tournament_id
        and seed.series_id=target_series_id
        and seed.team_id=target_seed_order[seed_i];
    end loop;

    for seed_i in 0..1 loop
      first_team := target_seed_order[3+seed_i];
      second_team := target_seed_order[case when seed_i=0 then 6 else 5 end];
      update public.tournament_matches m set
        team_a_id=first_team, team_b_id=second_team,
        final_seed_a=3+seed_i,
        final_seed_b=case when seed_i=0 then 6 else 5 end,
        updated_at=now()
      where m.tournament_id=target_tournament_id
        and m.series_id=target_series_id
        and m.phase='finals' and m.final_round_number=0
        and m.display_order=seed_i;
    end loop;
  end if;

  update public.tournament_series set finals_cross_pools=enable_cross_pools
    where id=target_series_id;
  insert into public.tournament_audit_log(
    tournament_id,action,payload,created_by
  ) values(
    target_tournament_id,'final_cross_pools_changed',
    jsonb_build_object(
      'series_id',target_series_id,
      'enabled',enable_cross_pools,
      'existing_bracket_repaired',existing_bracket
    ),auth.uid()
  );
  return enable_cross_pools;
end;
$$;

revoke all on function public.admin_set_tournament_final_cross_pools(uuid,uuid,boolean) from public,anon;
grant execute on function public.admin_set_tournament_final_cross_pools(uuid,uuid,boolean) to authenticated;


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

    if target_series.finals_cross_pools then
      -- The official pool standings, not global ranking, determine the bracket.
      -- 1=P1 first, 2=P2 first, 3=P2 second, 4=P1 second,
      -- 5=P2 third, 6=P1 third.
      if qualifier_count <> 6
        or (select count(*) from public.tournament_pools p
            where p.series_id=target_series.id) <> 2
        or exists (
          select 1 from public.tournament_pools p
          where p.series_id=target_series.id
            and (select count(*) from public.tournament_pool_teams pt
                 where pt.pool_id=p.id) <> 3
        ) then
        raise exception 'Cross-pool bracket requires exactly two pools of three'
          using errcode='P0001';
      end if;

      insert into public.tournament_final_seeds (
        tournament_id, series_id, seed, team_id
      )
      select
        target_tournament.id,
        target_series.id,
        case (pool.value->>'number')::integer
          when 1 then case (team.value->>'position')::integer
            when 1 then 1 when 2 then 4 when 3 then 6 end
          when 2 then case (team.value->>'position')::integer
            when 1 then 2 when 2 then 3 when 3 then 5 end
        end,
        (team.value->>'team_id')::uuid
      from jsonb_array_elements(
        coalesce(public.get_tournament_rankings(target_tournament.id)->'series','[]'::jsonb)
      ) as serie(value)
      cross join lateral jsonb_array_elements(
        coalesce(serie.value->'pools','[]'::jsonb)
      ) as pool(value)
      cross join lateral jsonb_array_elements(
        coalesce(pool.value->'teams','[]'::jsonb)
      ) as team(value)
      where (serie.value->>'id')::uuid = target_series.id
        and (pool.value->>'number')::integer in (1,2)
        and (team.value->>'position')::integer in (1,2,3);

      if (select count(*) from public.tournament_final_seeds seed
          where seed.tournament_id=target_tournament.id
            and seed.series_id=target_series.id) <> 6 then
        raise exception 'Pool standings are incomplete for cross-pool bracket'
          using errcode='P0001';
      end if;
    else
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
    end if;

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



-- Advance only the selected series; never advance other series as a side effect.
create or replace function public.admin_advance_tournament_final_stage(
  target_tournament_id uuid,
  target_series_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  target_series record;
  current_round_number integer;
  current_round text;
  current_match_count integer;
  validated_count integer;
  qualifier_count integer;
  main_bracket_size integer;
  direct_count integer;
  seed_order integer[];
  seed_index integer;
  seed_a integer;
  seed_b integer;
  team_a uuid;
  team_b uuid;
  winner_teams uuid[];
  display_index integer;
  next_round text;
  inserted_count integer := 0;
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

  for target_series in
    select series.id, series.finals_qualifier_count, series.finals_cross_pools
    from public.tournament_series as series
    where series.tournament_id = target_tournament.id
      and series.id = target_series_id
      and series.enabled
      and exists (
        select 1
        from public.tournament_final_seeds as seed
        where seed.tournament_id = target_tournament.id
          and seed.series_id = series.id
      )
    order by series.display_order, series.name
  loop
    select max(match.final_round_number)
    into current_round_number
    from public.tournament_matches as match
    where match.tournament_id = target_tournament.id
      and match.series_id = target_series.id
      and match.phase = 'finals';

    if current_round_number is null then
      continue;
    end if;

    select min(match.final_round), count(*)::integer
    into current_round, current_match_count
    from public.tournament_matches as match
    where match.tournament_id = target_tournament.id
      and match.series_id = target_series.id
      and match.phase = 'finals'
      and match.final_round_number = current_round_number;

    select count(*)::integer
    into validated_count
    from public.tournament_matches as match
    join public.tournament_match_results as result
      on result.match_id = match.id
     and result.status = 'validated'
    where match.tournament_id = target_tournament.id
      and match.series_id = target_series.id
      and match.phase = 'finals'
      and match.final_round_number = current_round_number;

    if current_match_count = 0 or validated_count <> current_match_count then
      continue;
    end if;

    if current_match_count = 1 and current_round = 'final' then
      continue;
    end if;

    if current_round_number = 0 then
      qualifier_count := target_series.finals_qualifier_count;
      main_bracket_size := public.tournament_main_bracket_size(qualifier_count);
      direct_count := 2 * main_bracket_size - qualifier_count;
      seed_order := case
        when target_series.finals_cross_pools
          then array[1,3,2,4]::integer[]
        else public.tournament_final_seed_order(main_bracket_size)
      end;
      next_round := public.tournament_final_round_key(main_bracket_size);
      seed_index := 1;
      display_index := 0;

      while seed_index <= array_length(seed_order, 1)
      loop
        seed_a := seed_order[seed_index];
        seed_b := seed_order[seed_index + 1];

        if seed_a <= direct_count then
          select seed.team_id into team_a
          from public.tournament_final_seeds as seed
          where seed.tournament_id = target_tournament.id
            and seed.series_id = target_series.id
            and seed.seed = seed_a;
        else
          select result.winner_team_id into team_a
          from public.tournament_matches as match
          join public.tournament_match_results as result
            on result.match_id = match.id
           and result.status = 'validated'
          where match.tournament_id = target_tournament.id
            and match.series_id = target_series.id
            and match.phase = 'finals'
            and match.final_round_number = 0
            and match.final_seed_a = seed_a;
        end if;

        if seed_b <= direct_count then
          select seed.team_id into team_b
          from public.tournament_final_seeds as seed
          where seed.tournament_id = target_tournament.id
            and seed.series_id = target_series.id
            and seed.seed = seed_b;
        else
          select result.winner_team_id into team_b
          from public.tournament_matches as match
          join public.tournament_match_results as result
            on result.match_id = match.id
           and result.status = 'validated'
          where match.tournament_id = target_tournament.id
            and match.series_id = target_series.id
            and match.phase = 'finals'
            and match.final_round_number = 0
            and match.final_seed_a = seed_b;
        end if;

        select seed.seed into seed_a
        from public.tournament_final_seeds as seed
        where seed.tournament_id = target_tournament.id
          and seed.series_id = target_series.id
          and seed.team_id = team_a;

        select seed.seed into seed_b
        from public.tournament_final_seeds as seed
        where seed.tournament_id = target_tournament.id
          and seed.series_id = target_series.id
          and seed.team_id = team_b;

        insert into public.tournament_matches (
          tournament_id, pool_id, series_id, team_a_id, team_b_id,
          display_order, status, phase, final_round, final_round_number,
          final_seed_a, final_seed_b, updated_at
        ) values (
          target_tournament.id, null, target_series.id, team_a, team_b,
          display_index, 'to_schedule', 'finals', next_round, 1,
          seed_a, seed_b, now()
        );

        inserted_count := inserted_count + 1;
        display_index := display_index + 1;
        seed_index := seed_index + 2;
      end loop;
    else
      select array_agg(result.winner_team_id order by match.display_order)
      into winner_teams
      from public.tournament_matches as match
      join public.tournament_match_results as result
        on result.match_id = match.id
       and result.status = 'validated'
      where match.tournament_id = target_tournament.id
        and match.series_id = target_series.id
        and match.phase = 'finals'
        and match.final_round_number = current_round_number;

      next_round := public.tournament_final_round_key(current_match_count);
      display_index := 0;
      seed_index := 1;

      while seed_index <= array_length(winner_teams, 1)
      loop
        team_a := winner_teams[seed_index];
        team_b := winner_teams[seed_index + 1];

        select seed.seed into seed_a
        from public.tournament_final_seeds as seed
        where seed.tournament_id = target_tournament.id
          and seed.series_id = target_series.id
          and seed.team_id = team_a;

        select seed.seed into seed_b
        from public.tournament_final_seeds as seed
        where seed.tournament_id = target_tournament.id
          and seed.series_id = target_series.id
          and seed.team_id = team_b;

        insert into public.tournament_matches (
          tournament_id, pool_id, series_id, team_a_id, team_b_id,
          display_order, status, phase, final_round, final_round_number,
          final_seed_a, final_seed_b, updated_at
        ) values (
          target_tournament.id, null, target_series.id, team_a, team_b,
          display_index, 'to_schedule', 'finals', next_round,
          current_round_number + 1, seed_a, seed_b, now()
        );

        inserted_count := inserted_count + 1;
        display_index := display_index + 1;
        seed_index := seed_index + 2;
      end loop;
    end if;
  end loop;

  if inserted_count > 0 then
    insert into public.tournament_audit_log (
      tournament_id, action, before_status, after_status, payload, created_by
    ) values (
      target_tournament.id,
      'final_stage_advanced',
      target_tournament.status,
      target_tournament.status,
      jsonb_build_object('matches_created', inserted_count),
      auth.uid()
    );
  end if;

  return inserted_count;
end;
$$;

revoke all on function public.admin_advance_tournament_final_stage(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_advance_tournament_final_stage(uuid, uuid)
to authenticated;


-- Keep public preliminary and semifinal projections aligned with the bracket.
create or replace function public.get_public_tournament_results(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    return null;
  end if;

  if not (
    target_tournament.status in (
      'planning_published',
      'in_progress',
      'completed',
      'archived'
    )
    or exists (
      select 1
      from public.tournament_matches as match
      join public.tournament_match_events as link on link.match_id = match.id
      join public.events as event on event.id = link.event_id
      where match.tournament_id = target_tournament.id
        and event.publication_status = 'published'
    )
    or exists (
      select 1
      from public.tournament_matches as match
      join public.tournament_match_results as result
        on result.match_id = match.id
       and result.status = 'validated'
      where match.tournament_id = target_tournament.id
    )
    or exists (
      select 1
      from public.tournament_final_seeds as seed
      where seed.tournament_id = target_tournament.id
    )
  ) then
    return null;
  end if;

  return jsonb_build_object(
    'tournament_id', target_tournament.id,
    'tournament_name', target_tournament.name,
    'status', target_tournament.status,
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', series.id,
          'name', series.name,
          'color', series.color,
          'display_order', series.display_order,
          'qualifier_count', series.finals_qualifier_count,
          'finals_cross_pools', series.finals_cross_pools,
          'finals_generated', exists (
            select 1
            from public.tournament_final_seeds as seed
            where seed.tournament_id = target_tournament.id
              and seed.series_id = series.id
          ),
          'final_seeds', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'seed', seed.seed,
                'team_id', seed.team_id,
                'team_label', public.tournament_team_public_label(seed.team_id)
              )
              order by seed.seed
            )
            from public.tournament_final_seeds as seed
            where seed.tournament_id = target_tournament.id
              and seed.series_id = series.id
          ), '[]'::jsonb),
          'final_matches', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', match.id,
                'round', match.final_round,
                'round_number', match.final_round_number,
                'display_order', match.display_order,
                'seed_a', match.final_seed_a,
                'seed_b', match.final_seed_b,
                'team_a_id', match.team_a_id,
                'team_a_label', public.tournament_team_public_label(match.team_a_id),
                'team_b_id', match.team_b_id,
                'team_b_label', public.tournament_team_public_label(match.team_b_id),
                'published', event.publication_status = 'published',
                'play_date', case
                  when event.publication_status = 'published'
                    or result.status = 'validated'
                    then planning.play_date
                  else null
                end,
                'starts_at', case
                  when event.publication_status = 'published'
                    or result.status = 'validated'
                    then planning.starts_at
                  else null
                end,
                'ends_at', case
                  when event.publication_status = 'published'
                    or result.status = 'validated'
                    then planning.ends_at
                  else null
                end,
                'resource_name', case
                  when event.publication_status = 'published'
                    or result.status = 'validated'
                    then resource.name
                  else null
                end,
                'result_status', result.status,
                'winner_team_id', case
                  when result.status = 'validated' then result.winner_team_id
                  else null
                end,
                'score', case
                  when result.status = 'validated' then result.score
                  else null
                end,
                'team_a_sets', case
                  when result.status = 'validated' then result.team_a_sets
                  else null
                end,
                'team_b_sets', case
                  when result.status = 'validated' then result.team_b_sets
                  else null
                end
              )
              order by match.final_round_number, match.display_order
            )
            from public.tournament_matches as match
            left join public.tournament_match_results as result
              on result.match_id = match.id
            left join public.tournament_match_planning as planning
              on planning.match_id = match.id
            left join public.reservable_resources as resource
              on resource.id = planning.resource_id
            left join public.tournament_match_events as event_link
              on event_link.match_id = match.id
            left join public.events as event
              on event.id = event_link.event_id
            where match.tournament_id = target_tournament.id
              and match.series_id = series.id
              and match.phase = 'finals'
          ), '[]'::jsonb),
          'pools', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', pool.id,
                'number', pool.display_order + 1,
                'matches', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', match.id,
                      'display_order', match.display_order,
                      'team_a_id', match.team_a_id,
                      'team_a_label', public.tournament_team_public_label(match.team_a_id),
                      'team_b_id', match.team_b_id,
                      'team_b_label', public.tournament_team_public_label(match.team_b_id),
                      'play_date', planning.play_date,
                      'starts_at', planning.starts_at,
                      'ends_at', planning.ends_at,
                      'scheduled_start_at', public.tournament_planning_starts_at(
                        planning.play_date,
                        planning.starts_at,
                        resource.timezone
                      ),
                      'scheduled_end_at', public.tournament_planning_starts_at(
                        planning.play_date,
                        planning.ends_at,
                        resource.timezone
                      ),
                      'resource_name', resource.name,
                      'result_status', result.status,
                      'score', case
                        when result.status = 'validated' then result.score
                        else null
                      end,
                      'team_a_sets', case
                        when result.status = 'validated' then result.team_a_sets
                        else null
                      end,
                      'team_b_sets', case
                        when result.status = 'validated' then result.team_b_sets
                        else null
                      end
                    )
                    order by planning.play_date, planning.starts_at, match.display_order
                  )
                  from public.tournament_matches as match
                  join public.tournament_match_planning as planning
                    on planning.match_id = match.id
                  join public.reservable_resources as resource
                    on resource.id = planning.resource_id
                  left join public.tournament_match_results as result
                    on result.match_id = match.id
                  where match.pool_id = pool.id
                    and match.phase = 'pools'
                ), '[]'::jsonb)
              )
              order by pool.display_order
            )
            from public.tournament_pools as pool
            where pool.tournament_id = target_tournament.id
              and pool.series_id = series.id
          ), '[]'::jsonb)
        )
        order by series.display_order, series.name
      )
      from public.tournament_series as series
      where series.tournament_id = target_tournament.id
        and series.enabled
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_tournament_results(uuid) from public;
grant execute on function public.get_public_tournament_results(uuid)
to anon, authenticated;

