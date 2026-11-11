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
    select series.id, series.finals_qualifier_count
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
      seed_order := public.tournament_final_seed_order(main_bracket_size);
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

