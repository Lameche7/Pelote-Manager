begin;

-- Active réellement la phase finale après la fin des poules. Les matchs de
-- phase finale réutilisent tournament_matches et le Result Engine existant.

alter table public.tournament_matches
  alter column pool_id drop not null;

alter table public.tournament_matches
  add column if not exists phase text not null default 'pools';

alter table public.tournament_matches
  add column if not exists final_round text;

alter table public.tournament_matches
  add column if not exists final_round_number integer;

alter table public.tournament_matches
  add column if not exists final_seed_a integer;

alter table public.tournament_matches
  add column if not exists final_seed_b integer;

alter table public.tournament_matches
  drop constraint if exists tournament_matches_phase_check;

alter table public.tournament_matches
  add constraint tournament_matches_phase_check
  check (
    (phase = 'pools' and pool_id is not null and final_round is null and final_round_number is null)
    or
    (phase = 'finals' and pool_id is null and final_round is not null and final_round_number is not null)
  );

alter table public.tournament_matches
  drop constraint if exists tournament_matches_final_round_number_check;

alter table public.tournament_matches
  add constraint tournament_matches_final_round_number_check
  check (final_round_number is null or final_round_number >= 0);

create unique index if not exists tournament_matches_final_round_order_unique
on public.tournament_matches (
  tournament_id,
  series_id,
  final_round_number,
  display_order
)
where phase = 'finals';

create table if not exists public.tournament_final_seeds (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  series_id uuid not null references public.tournament_series (id) on delete cascade,
  seed integer not null check (seed >= 1),
  team_id uuid not null references public.tournament_teams (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (tournament_id, series_id, seed),
  unique (tournament_id, series_id, team_id)
);

create index if not exists tournament_final_seeds_team_idx
on public.tournament_final_seeds (team_id);

alter table public.tournament_final_seeds enable row level security;
revoke all on table public.tournament_final_seeds from public, anon, authenticated;

create or replace function public.tournament_final_seed_order(bracket_size integer)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  previous integer[];
  result integer[] := '{}'::integer[];
  current_seed integer;
begin
  if bracket_size < 2 or (bracket_size & (bracket_size - 1)) <> 0 then
    raise exception 'Final bracket size must be a power of two'
      using errcode = '22023';
  end if;

  if bracket_size = 2 then
    return array[1, 2];
  end if;

  previous := public.tournament_final_seed_order(bracket_size / 2);
  foreach current_seed in array previous
  loop
    result := array_append(result, current_seed);
    result := array_append(result, bracket_size + 1 - current_seed);
  end loop;

  return result;
end;
$$;

create or replace function public.tournament_final_round_key(bracket_size integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case bracket_size
    when 2 then 'final'
    when 4 then 'semifinal'
    when 8 then 'quarterfinal'
    when 16 then 'round_of_16'
    when 32 then 'round_of_32'
    else concat('round_of_', bracket_size)
  end;
$$;

revoke all on function public.tournament_final_seed_order(integer)
from public, anon, authenticated;
revoke all on function public.tournament_final_round_key(integer)
from public, anon, authenticated;

create or replace function public.admin_get_tournament_final_stage(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'tournament_id', target_tournament.id,
    'status', target_tournament.status,
    'finals_starts_on', target_tournament.finals_starts_on,
    'finals_ends_on', target_tournament.finals_ends_on,
    'generated', exists (
      select 1
      from public.tournament_final_seeds as seed
      where seed.tournament_id = target_tournament.id
    ),
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'series_id', series.id,
          'series_name', series.name,
          'qualifier_count', series.finals_qualifier_count,
          'pool_match_count', (
            select count(*)::integer
            from public.tournament_matches as match
            where match.tournament_id = target_tournament.id
              and match.series_id = series.id
              and match.phase = 'pools'
          ),
          'validated_pool_match_count', (
            select count(*)::integer
            from public.tournament_matches as match
            join public.tournament_match_results as result
              on result.match_id = match.id
             and result.status = 'validated'
            where match.tournament_id = target_tournament.id
              and match.series_id = series.id
              and match.phase = 'pools'
          ),
          'cutoff_tie', coalesce((
            select bool_or(
              ranking.tie_first_position <= series.finals_qualifier_count
              and ranking.tie_last_position > series.finals_qualifier_count
            )
            from public.tournament_general_ranking_rows(
              target_tournament.id,
              series.id
            ) as ranking
          ), false),
          'generated', exists (
            select 1
            from public.tournament_final_seeds as seed
            where seed.tournament_id = target_tournament.id
              and seed.series_id = series.id
          ),
          'seeds', coalesce((
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
          'current_round_number', (
            select max(match.final_round_number)
            from public.tournament_matches as match
            where match.tournament_id = target_tournament.id
              and match.series_id = series.id
              and match.phase = 'finals'
          ),
          'matches', coalesce((
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
                'result_status', result.status,
                'winner_team_id', result.winner_team_id,
                'planned', planning.match_id is not null,
                'published', event_link.match_id is not null,
                'play_date', planning.play_date,
                'starts_at', planning.starts_at,
                'ends_at', planning.ends_at,
                'resource_id', planning.resource_id,
                'resource_name', resource.name
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
            where match.tournament_id = target_tournament.id
              and match.series_id = series.id
              and match.phase = 'finals'
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

revoke all on function public.admin_get_tournament_final_stage(uuid)
from public, anon, authenticated;
grant execute on function public.admin_get_tournament_final_stage(uuid)
to authenticated;

create or replace function public.admin_generate_tournament_final_stage(
  target_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
  ) then
    raise exception 'Tournament final stage is already generated'
      using errcode = 'P0001';
  end if;

  for target_series in
    select series.*
    from public.tournament_series as series
    where series.tournament_id = target_tournament.id
      and series.enabled
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
$$;

revoke all on function public.admin_generate_tournament_final_stage(uuid)
from public, anon, authenticated;
grant execute on function public.admin_generate_tournament_final_stage(uuid)
to authenticated;

create or replace function public.admin_advance_tournament_final_stage(
  target_tournament_id uuid
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

revoke all on function public.admin_advance_tournament_final_stage(uuid)
from public, anon, authenticated;
grant execute on function public.admin_advance_tournament_final_stage(uuid)
to authenticated;

-- Workspace compact pour le tour final actuellement jouable. Il réutilise le
-- Planning Engine TypeScript avec les créneaux et disponibilités de phase finale.
create or replace function public.admin_get_tournament_final_planning_workspace(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.tournament_final_seeds as seed
    where seed.tournament_id = target_tournament.id
  ) then
    raise exception 'Tournament final stage has not been generated'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', target_tournament.id,
      'name', target_tournament.name,
      'status', target_tournament.status,
      'starts_on', target_tournament.starts_on,
      'ends_on', target_tournament.ends_on,
      'pool_starts_on', target_tournament.pool_starts_on,
      'pool_ends_on', target_tournament.pool_ends_on,
      'finals_starts_on', target_tournament.finals_starts_on,
      'finals_ends_on', target_tournament.finals_ends_on,
      'slot_duration_minutes', target_tournament.slot_duration_minutes,
      'minimum_rest_minutes', 0
    ),
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', series.id,
          'name', series.name,
          'color', series.color,
          'display_order', series.display_order
        ) order by series.display_order, series.name
      )
      from public.tournament_series as series
      where series.tournament_id = target_tournament.id
        and series.enabled
    ), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', resource.id,
          'name', resource.name,
          'display_order', selected.display_order
        ) order by selected.display_order, resource.name
      )
      from public.tournament_resources as selected
      join public.reservable_resources as resource on resource.id = selected.resource_id
      where selected.tournament_id = target_tournament.id
    ), '[]'::jsonb),
    'slots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', concat(selected.resource_id, '|', generated.play_date, '|', generated.starts_at, '|', generated.ends_at),
          'resource_id', selected.resource_id,
          'resource_name', resource.name,
          'date', generated.play_date,
          'starts_at', generated.starts_at,
          'ends_at', generated.ends_at
        ) order by generated.play_date, generated.starts_at, selected.display_order
      )
      from public.tournament_generated_slots(target_tournament.id) as generated
      cross join public.tournament_resources as selected
      join public.reservable_resources as resource on resource.id = selected.resource_id
      where selected.tournament_id = target_tournament.id
        and generated.phase = 'finals'
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', team.id,
          'players', (
            select coalesce(jsonb_agg(
              jsonb_build_object('first_name', player.first_name, 'last_name', player.last_name, 'role', player.role)
              order by player.display_order
            ), '[]'::jsonb)
            from public.tournament_team_players as player
            where player.team_id = team.id
          )
        ) order by team.registered_at, team.id
      )
      from public.tournament_teams as team
      where team.tournament_id = target_tournament.id
        and team.status = 'accepted'
    ), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'team_id', team.id,
          'slots', (
            select coalesce(jsonb_agg(
              jsonb_build_object('date', availability.play_date, 'starts_at', availability.starts_at, 'ends_at', availability.ends_at)
              order by availability.play_date, availability.starts_at
            ), '[]'::jsonb)
            from public.tournament_team_availability_slots as availability
            join public.tournament_generated_slots(target_tournament.id) as generated
              on generated.play_date = availability.play_date
             and generated.starts_at = availability.starts_at
             and generated.ends_at = availability.ends_at
             and generated.phase = 'finals'
            where availability.tournament_id = target_tournament.id
              and availability.team_id = team.id
          )
        ) order by team.id
      )
      from public.tournament_teams as team
      where team.tournament_id = target_tournament.id
        and team.status = 'accepted'
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', match.id,
          'pool_id', '',
          'series_id', match.series_id,
          'team_a_id', match.team_a_id,
          'team_b_id', match.team_b_id,
          'display_order', match.display_order,
          'final_round', match.final_round
        ) order by series.display_order, match.final_round_number, match.display_order
      )
      from public.tournament_matches as match
      join public.tournament_series as series on series.id = match.series_id
      where match.tournament_id = target_tournament.id
        and match.phase = 'finals'
        and not exists (
          select 1 from public.tournament_match_results as result
          where result.match_id = match.id and result.status = 'validated'
        )
        and match.final_round_number = (
          select max(current_match.final_round_number)
          from public.tournament_matches as current_match
          where current_match.tournament_id = match.tournament_id
            and current_match.series_id = match.series_id
            and current_match.phase = 'finals'
        )
    ), '[]'::jsonb),
    'planning', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'match_id', planning.match_id,
          'slot_id', concat(planning.resource_id, '|', planning.play_date, '|', planning.starts_at, '|', planning.ends_at),
          'source', planning.source
        ) order by planning.play_date, planning.starts_at, planning.resource_id
      )
      from public.tournament_match_planning as planning
      join public.tournament_matches as match on match.id = planning.match_id
      where planning.tournament_id = target_tournament.id
        and match.phase = 'finals'
        and not exists (
          select 1 from public.tournament_match_results as result
          where result.match_id = match.id and result.status = 'validated'
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_tournament_final_planning_workspace(uuid)
from public, anon, authenticated;
grant execute on function public.admin_get_tournament_final_planning_workspace(uuid)
to authenticated;

create or replace function public.admin_save_tournament_final_planning(
  target_tournament_id uuid,
  payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  planning_values jsonb := coalesce(payload->'planning', '[]'::jsonb);
  planning_item jsonb;
  target_match public.tournament_matches;
  target_match_id uuid;
  target_resource_id uuid;
  target_play_date date;
  target_starts_at time;
  target_ends_at time;
  target_source text;
  expected_count integer;
  assigned_count integer := 0;
  seen_match_ids uuid[] := '{}'::uuid[];
  seen_slot_keys text[] := '{}'::text[];
  seen_team_slot_keys text[] := '{}'::text[];
  slot_key text;
  team_key_a text;
  team_key_b text;
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

  if jsonb_typeof(planning_values) <> 'array' then
    raise exception 'Tournament finals planning payload is invalid'
      using errcode = '22023';
  end if;

  select count(*)::integer into expected_count
  from public.tournament_matches as match
  where match.tournament_id = target_tournament.id
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
      select 1 from public.tournament_match_events as event_link
      where event_link.match_id = match.id
    );

  if expected_count = 0 then
    raise exception 'No tournament finals matches are ready for planning'
      using errcode = 'P0001';
  end if;

  if jsonb_array_length(planning_values) <> expected_count then
    raise exception 'Every current finals match must be scheduled exactly once'
      using errcode = 'P0001';
  end if;

  -- Les plans non publiés du tour courant peuvent être remplacés.
  delete from public.tournament_match_planning as planning
  where planning.match_id in (
    select match.id
    from public.tournament_matches as match
    where match.tournament_id = target_tournament.id
      and match.phase = 'finals'
      and not exists (
        select 1 from public.tournament_match_events as event_link
        where event_link.match_id = match.id
      )
      and not exists (
        select 1 from public.tournament_match_results as result
        where result.match_id = match.id and result.status = 'validated'
      )
  );

  for planning_item in
    select value from jsonb_array_elements(planning_values)
  loop
    target_match_id := nullif(planning_item->>'match_id', '')::uuid;
    target_resource_id := nullif(planning_item->>'resource_id', '')::uuid;
    target_play_date := nullif(planning_item->>'play_date', '')::date;
    target_starts_at := nullif(planning_item->>'starts_at', '')::time;
    target_ends_at := nullif(planning_item->>'ends_at', '')::time;
    target_source := coalesce(nullif(planning_item->>'source', ''), 'generated');

    if target_match_id is null
      or target_resource_id is null
      or target_play_date is null
      or target_starts_at is null
      or target_ends_at is null
      or target_ends_at <= target_starts_at
      or target_source not in ('generated', 'manual')
      or target_match_id = any(seen_match_ids) then
      raise exception 'Tournament finals planning payload is invalid'
        using errcode = '22023';
    end if;

    select match.* into target_match
    from public.tournament_matches as match
    where match.id = target_match_id
      and match.tournament_id = target_tournament.id
      and match.phase = 'finals'
      and match.final_round_number = (
        select max(current_match.final_round_number)
        from public.tournament_matches as current_match
        where current_match.tournament_id = match.tournament_id
          and current_match.series_id = match.series_id
          and current_match.phase = 'finals'
      );

    if target_match.id is null then
      raise exception 'Tournament finals planning match is invalid'
        using errcode = '22023';
    end if;

    if exists (
      select 1 from public.tournament_match_events as event_link
      where event_link.match_id = target_match.id
    ) then
      raise exception 'Published tournament finals match is locked'
        using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from public.tournament_resources as selected
      where selected.tournament_id = target_tournament.id
        and selected.resource_id = target_resource_id
    ) then
      raise exception 'Tournament finals planning resource is invalid'
        using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'finals'
        and generated.play_date = target_play_date
        and generated.starts_at = target_starts_at
        and generated.ends_at = target_ends_at
    ) then
      raise exception 'Tournament finals planning slot is invalid'
        using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.tournament_team_availability_slots as availability
      where availability.tournament_id = target_tournament.id
        and availability.team_id = target_match.team_a_id
        and availability.play_date = target_play_date
        and availability.starts_at = target_starts_at
        and availability.ends_at = target_ends_at
    ) or not exists (
      select 1 from public.tournament_team_availability_slots as availability
      where availability.tournament_id = target_tournament.id
        and availability.team_id = target_match.team_b_id
        and availability.play_date = target_play_date
        and availability.starts_at = target_starts_at
        and availability.ends_at = target_ends_at
    ) then
      raise exception 'Tournament finals planning violates team availability'
        using errcode = 'P0001';
    end if;

    slot_key := concat(target_resource_id, '|', target_play_date, '|', target_starts_at);
    team_key_a := concat(target_match.team_a_id, '|', target_play_date, '|', target_starts_at);
    team_key_b := concat(target_match.team_b_id, '|', target_play_date, '|', target_starts_at);

    if slot_key = any(seen_slot_keys)
      or team_key_a = any(seen_team_slot_keys)
      or team_key_b = any(seen_team_slot_keys) then
      raise exception 'Tournament finals planning contains a conflict'
        using errcode = '23P01';
    end if;

    insert into public.tournament_match_planning (
      match_id, tournament_id, resource_id, play_date, starts_at, ends_at,
      source, updated_at
    ) values (
      target_match.id, target_tournament.id, target_resource_id,
      target_play_date, target_starts_at, target_ends_at, target_source, now()
    );

    update public.tournament_matches
    set status = 'scheduled', updated_at = now()
    where id = target_match.id;

    seen_match_ids := array_append(seen_match_ids, target_match.id);
    seen_slot_keys := array_append(seen_slot_keys, slot_key);
    seen_team_slot_keys := array_append(seen_team_slot_keys, team_key_a);
    seen_team_slot_keys := array_append(seen_team_slot_keys, team_key_b);
    assigned_count := assigned_count + 1;
  end loop;

  insert into public.tournament_audit_log (
    tournament_id, action, before_status, after_status, payload, created_by
  ) values (
    target_tournament.id,
    'final_round_planned',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object('matches_planned', assigned_count),
    auth.uid()
  );

  return assigned_count;
end;
$$;

revoke all on function public.admin_save_tournament_final_planning(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.admin_save_tournament_final_planning(uuid, jsonb)
to authenticated;

create or replace function public.admin_publish_tournament_final_round(
  target_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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

  if exists (
    select 1
    from public.tournament_matches as match
    where match.tournament_id = target_tournament.id
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
$$;

revoke all on function public.admin_publish_tournament_final_round(uuid)
from public, anon, authenticated;
grant execute on function public.admin_publish_tournament_final_round(uuid)
to authenticated;

commit;
