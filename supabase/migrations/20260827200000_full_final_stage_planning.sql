begin;

-- Planification globale des phases finales.
-- Le tableau sportif réel continue d'utiliser tournament_matches, mais cette
-- grille existe dès la génération pour réserver les créneaux de tous les tours
-- et de toutes les séries avant de connaître les futurs vainqueurs.

create table if not exists public.tournament_final_planning_nodes (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  series_id uuid not null references public.tournament_series (id) on delete cascade,
  round text not null,
  round_number integer not null check (round_number >= 0),
  display_order integer not null check (display_order >= 0),
  resource_id uuid references public.reservable_resources (id) on delete restrict,
  play_date date,
  starts_at time,
  ends_at time,
  source text check (source in ('generated', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tournament_id, series_id, round_number, display_order),
  check (
    (
      resource_id is null
      and play_date is null
      and starts_at is null
      and ends_at is null
      and source is null
    )
    or
    (
      resource_id is not null
      and play_date is not null
      and starts_at is not null
      and ends_at is not null
      and source is not null
      and ends_at > starts_at
    )
  )
);

create unique index if not exists tournament_final_planning_nodes_slot_unique
on public.tournament_final_planning_nodes (
  tournament_id,
  resource_id,
  play_date,
  starts_at
)
where resource_id is not null;

create index if not exists tournament_final_planning_nodes_round_idx
on public.tournament_final_planning_nodes (
  tournament_id,
  round_number,
  series_id,
  display_order
);

alter table public.tournament_final_planning_nodes enable row level security;
revoke all on table public.tournament_final_planning_nodes
from public, anon, authenticated;

create or replace function public.sync_tournament_final_planning_node_to_match(
  target_match_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.tournament_matches;
  target_node public.tournament_final_planning_nodes;
  can_apply boolean := false;
begin
  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = target_match_id
    and match.phase = 'finals';

  if target_match.id is null then
    return;
  end if;

  if exists (
    select 1
    from public.tournament_match_events as event_link
    where event_link.match_id = target_match.id
  ) or exists (
    select 1
    from public.tournament_match_results as result
    where result.match_id = target_match.id
      and result.status = 'validated'
  ) then
    return;
  end if;

  select node.*
  into target_node
  from public.tournament_final_planning_nodes as node
  where node.tournament_id = target_match.tournament_id
    and node.series_id = target_match.series_id
    and node.round_number = target_match.final_round_number
    and node.display_order = target_match.display_order;

  if target_node.tournament_id is null or target_node.resource_id is null then
    delete from public.tournament_match_planning as planning
    where planning.match_id = target_match.id;

    update public.tournament_matches
    set status = 'to_schedule', updated_at = now()
    where id = target_match.id;
    return;
  end if;

  can_apply := target_node.source = 'manual'
    or (
      exists (
        select 1
        from public.tournament_team_availability_slots as availability
        where availability.tournament_id = target_match.tournament_id
          and availability.team_id = target_match.team_a_id
          and availability.play_date = target_node.play_date
          and availability.starts_at = target_node.starts_at
          and availability.ends_at = target_node.ends_at
      )
      and exists (
        select 1
        from public.tournament_team_availability_slots as availability
        where availability.tournament_id = target_match.tournament_id
          and availability.team_id = target_match.team_b_id
          and availability.play_date = target_node.play_date
          and availability.starts_at = target_node.starts_at
          and availability.ends_at = target_node.ends_at
      )
    );

  if not can_apply then
    delete from public.tournament_match_planning as planning
    where planning.match_id = target_match.id;

    update public.tournament_matches
    set status = 'to_schedule', updated_at = now()
    where id = target_match.id;
    return;
  end if;

  insert into public.tournament_match_planning (
    match_id,
    tournament_id,
    resource_id,
    play_date,
    starts_at,
    ends_at,
    source,
    updated_at
  )
  values (
    target_match.id,
    target_match.tournament_id,
    target_node.resource_id,
    target_node.play_date,
    target_node.starts_at,
    target_node.ends_at,
    target_node.source,
    now()
  )
  on conflict (match_id) do update
  set
    resource_id = excluded.resource_id,
    play_date = excluded.play_date,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    source = excluded.source,
    updated_at = now();

  update public.tournament_matches
  set status = 'scheduled', updated_at = now()
  where id = target_match.id;
end;
$$;

revoke all on function public.sync_tournament_final_planning_node_to_match(uuid)
from public, anon, authenticated;

create or replace function public.on_tournament_final_match_created_sync_planning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phase = 'finals' then
    perform public.sync_tournament_final_planning_node_to_match(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.on_tournament_final_match_created_sync_planning()
from public, anon, authenticated;

drop trigger if exists tournament_final_match_created_sync_planning
on public.tournament_matches;

create trigger tournament_final_match_created_sync_planning
after insert on public.tournament_matches
for each row
when (new.phase = 'finals')
execute function public.on_tournament_final_match_created_sync_planning();

create or replace function public.admin_prepare_tournament_final_planning_grid(
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
  qualifier_count integer;
  main_bracket_size integer;
  preliminary_count integer;
  bracket_size integer;
  round_number integer;
  match_count integer;
  target_round text;
  prepared_count integer;
  target_match record;
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

  if not exists (
    select 1
    from public.tournament_final_seeds as seed
    where seed.tournament_id = target_tournament.id
  ) then
    raise exception 'Tournament final stage has not been generated'
      using errcode = 'P0001';
  end if;

  for target_series in
    select series.id
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
    select count(*)::integer
    into qualifier_count
    from public.tournament_final_seeds as seed
    where seed.tournament_id = target_tournament.id
      and seed.series_id = target_series.id;

    main_bracket_size := public.tournament_main_bracket_size(qualifier_count);
    preliminary_count := qualifier_count - main_bracket_size;

    if preliminary_count > 0 then
      insert into public.tournament_final_planning_nodes (
        tournament_id,
        series_id,
        round,
        round_number,
        display_order
      )
      select
        target_tournament.id,
        target_series.id,
        'preliminary',
        0,
        generated.display_order
      from generate_series(0, preliminary_count - 1) as generated(display_order)
      on conflict (tournament_id, series_id, round_number, display_order)
      do nothing;
    end if;

    bracket_size := main_bracket_size;
    round_number := 1;

    while bracket_size >= 2
    loop
      target_round := public.tournament_final_round_key(bracket_size);
      match_count := bracket_size / 2;

      insert into public.tournament_final_planning_nodes (
        tournament_id,
        series_id,
        round,
        round_number,
        display_order
      )
      select
        target_tournament.id,
        target_series.id,
        target_round,
        round_number,
        generated.display_order
      from generate_series(0, match_count - 1) as generated(display_order)
      on conflict (tournament_id, series_id, round_number, display_order)
      do nothing;

      bracket_size := bracket_size / 2;
      round_number := round_number + 1;
    end loop;
  end loop;

  -- Un tournoi déjà engagé peut être migré sans perdre ses horaires existants.
  update public.tournament_final_planning_nodes as node
  set
    resource_id = planning.resource_id,
    play_date = planning.play_date,
    starts_at = planning.starts_at,
    ends_at = planning.ends_at,
    source = planning.source,
    updated_at = now()
  from public.tournament_matches as match
  join public.tournament_match_planning as planning
    on planning.match_id = match.id
  where node.tournament_id = target_tournament.id
    and match.tournament_id = node.tournament_id
    and match.series_id = node.series_id
    and match.phase = 'finals'
    and match.final_round_number = node.round_number
    and match.display_order = node.display_order;

  for target_match in
    select match.id
    from public.tournament_matches as match
    where match.tournament_id = target_tournament.id
      and match.phase = 'finals'
  loop
    perform public.sync_tournament_final_planning_node_to_match(target_match.id);
  end loop;

  select count(*)::integer
  into prepared_count
  from public.tournament_final_planning_nodes as node
  where node.tournament_id = target_tournament.id;

  return prepared_count;
end;
$$;

revoke all on function public.admin_prepare_tournament_final_planning_grid(uuid)
from public, anon, authenticated;
grant execute on function public.admin_prepare_tournament_final_planning_grid(uuid)
to authenticated;

create or replace function public.admin_get_tournament_final_full_planning_workspace(
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
    'tournament', jsonb_build_object(
      'id', target_tournament.id,
      'name', target_tournament.name,
      'finals_starts_on', target_tournament.finals_starts_on,
      'finals_ends_on', target_tournament.finals_ends_on,
      'minimum_rest_minutes', 0
    ),
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', series.id,
          'name', series.name,
          'color', series.color,
          'display_order', series.display_order,
          'qualifier_count', (
            select count(*)::integer
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
          ), '[]'::jsonb)
        )
        order by series.display_order, series.name
      )
      from public.tournament_series as series
      where series.tournament_id = target_tournament.id
        and series.enabled
        and exists (
          select 1
          from public.tournament_final_seeds as seed
          where seed.tournament_id = target_tournament.id
            and seed.series_id = series.id
        )
    ), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', resource.id,
          'name', resource.name,
          'display_order', selected.display_order
        )
        order by selected.display_order, resource.name
      )
      from public.tournament_resources as selected
      join public.reservable_resources as resource
        on resource.id = selected.resource_id
      where selected.tournament_id = target_tournament.id
    ), '[]'::jsonb),
    'slots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', concat(
            selected.resource_id,
            '|', generated.play_date,
            '|', generated.starts_at,
            '|', generated.ends_at
          ),
          'resource_id', selected.resource_id,
          'resource_name', resource.name,
          'date', generated.play_date,
          'starts_at', generated.starts_at,
          'ends_at', generated.ends_at
        )
        order by generated.play_date, generated.starts_at, selected.display_order
      )
      from public.tournament_generated_slots(target_tournament.id) as generated
      cross join public.tournament_resources as selected
      join public.reservable_resources as resource
        on resource.id = selected.resource_id
      where selected.tournament_id = target_tournament.id
        and generated.phase = 'finals'
    ), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'team_id', team.id,
          'slots', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'date', availability.play_date,
                  'starts_at', availability.starts_at,
                  'ends_at', availability.ends_at
                )
                order by availability.play_date, availability.starts_at
              ),
              '[]'::jsonb
            )
            from public.tournament_team_availability_slots as availability
            join public.tournament_generated_slots(target_tournament.id) as generated
              on generated.play_date = availability.play_date
             and generated.starts_at = availability.starts_at
             and generated.ends_at = availability.ends_at
             and generated.phase = 'finals'
            where availability.tournament_id = target_tournament.id
              and availability.team_id = team.id
          )
        )
        order by team.id
      )
      from public.tournament_teams as team
      where team.tournament_id = target_tournament.id
        and team.status = 'accepted'
    ), '[]'::jsonb),
    'nodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'series_id', node.series_id,
          'round', node.round,
          'round_number', node.round_number,
          'display_order', node.display_order,
          'resource_id', node.resource_id,
          'play_date', node.play_date,
          'starts_at', node.starts_at,
          'ends_at', node.ends_at,
          'source', node.source,
          'actual_match_id', match.id,
          'team_a_id', match.team_a_id,
          'team_a_label', case
            when match.id is null then null
            else public.tournament_team_public_label(match.team_a_id)
          end,
          'team_b_id', match.team_b_id,
          'team_b_label', case
            when match.id is null then null
            else public.tournament_team_public_label(match.team_b_id)
          end,
          'result_status', result.status,
          'published', event_link.match_id is not null,
          'actual_match_planned', match_planning.match_id is not null,
          'needs_manual', (
            match.id is not null
            and node.resource_id is not null
            and match_planning.match_id is null
            and result.status is distinct from 'validated'
            and event_link.match_id is null
          )
        )
        order by series.display_order, node.round_number, node.display_order
      )
      from public.tournament_final_planning_nodes as node
      join public.tournament_series as series on series.id = node.series_id
      left join public.tournament_matches as match
        on match.tournament_id = node.tournament_id
       and match.series_id = node.series_id
       and match.phase = 'finals'
       and match.final_round_number = node.round_number
       and match.display_order = node.display_order
      left join public.tournament_match_results as result
        on result.match_id = match.id
      left join public.tournament_match_events as event_link
        on event_link.match_id = match.id
      left join public.tournament_match_planning as match_planning
        on match_planning.match_id = match.id
      where node.tournament_id = target_tournament.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_tournament_final_full_planning_workspace(uuid)
from public, anon, authenticated;
grant execute on function public.admin_get_tournament_final_full_planning_workspace(uuid)
to authenticated;

create or replace function public.admin_save_tournament_final_full_planning(
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
  planning_values jsonb := coalesce(payload->'nodes', '[]'::jsonb);
  planning_item jsonb;
  target_node public.tournament_final_planning_nodes;
  target_match public.tournament_matches;
  target_series_id uuid;
  target_round_number integer;
  target_display_order integer;
  target_resource_id uuid;
  target_play_date date;
  target_starts_at time;
  target_ends_at time;
  target_source text;
  node_key text;
  seen_node_keys text[] := '{}'::text[];
  planned_count integer := 0;
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

  if jsonb_typeof(planning_values) <> 'array' then
    raise exception 'Tournament finals full planning payload is invalid'
      using errcode = '22023';
  end if;

  -- Première passe : verrouillage logique et libération des nœuds modifiés.
  for planning_item in
    select value from jsonb_array_elements(planning_values)
  loop
    target_series_id := nullif(planning_item->>'series_id', '')::uuid;
    target_round_number := nullif(planning_item->>'round_number', '')::integer;
    target_display_order := nullif(planning_item->>'display_order', '')::integer;
    node_key := concat(
      target_series_id,
      '|', target_round_number,
      '|', target_display_order
    );

    if target_series_id is null
      or target_round_number is null
      or target_display_order is null
      or node_key = any(seen_node_keys) then
      raise exception 'Tournament finals full planning payload is invalid'
        using errcode = '22023';
    end if;

    select node.*
    into target_node
    from public.tournament_final_planning_nodes as node
    where node.tournament_id = target_tournament.id
      and node.series_id = target_series_id
      and node.round_number = target_round_number
      and node.display_order = target_display_order
    for update;

    if target_node.tournament_id is null then
      raise exception 'Tournament finals planning node is invalid'
        using errcode = '22023';
    end if;

    select match.*
    into target_match
    from public.tournament_matches as match
    where match.tournament_id = target_tournament.id
      and match.series_id = target_series_id
      and match.phase = 'finals'
      and match.final_round_number = target_round_number
      and match.display_order = target_display_order;

    if target_match.id is not null and (
      exists (
        select 1
        from public.tournament_match_events as event_link
        where event_link.match_id = target_match.id
      )
      or exists (
        select 1
        from public.tournament_match_results as result
        where result.match_id = target_match.id
          and result.status = 'validated'
      )
    ) then
      raise exception 'Published or completed tournament finals node is locked'
        using errcode = 'P0001';
    end if;

    update public.tournament_final_planning_nodes as node
    set
      resource_id = null,
      play_date = null,
      starts_at = null,
      ends_at = null,
      source = null,
      updated_at = now()
    where node.tournament_id = target_tournament.id
      and node.series_id = target_series_id
      and node.round_number = target_round_number
      and node.display_order = target_display_order;

    if target_match.id is not null then
      delete from public.tournament_match_planning as planning
      where planning.match_id = target_match.id;

      update public.tournament_matches
      set status = 'to_schedule', updated_at = now()
      where id = target_match.id;
    end if;

    seen_node_keys := array_append(seen_node_keys, node_key);
  end loop;

  -- Deuxième passe : nouvelle affectation. Un nœud sans resource_id reste
  -- volontairement « À programmer ».
  for planning_item in
    select value from jsonb_array_elements(planning_values)
  loop
    target_series_id := nullif(planning_item->>'series_id', '')::uuid;
    target_round_number := nullif(planning_item->>'round_number', '')::integer;
    target_display_order := nullif(planning_item->>'display_order', '')::integer;
    target_resource_id := nullif(planning_item->>'resource_id', '')::uuid;
    target_play_date := nullif(planning_item->>'play_date', '')::date;
    target_starts_at := nullif(planning_item->>'starts_at', '')::time;
    target_ends_at := nullif(planning_item->>'ends_at', '')::time;
    target_source := nullif(planning_item->>'source', '');

    if target_resource_id is null then
      if target_play_date is not null
        or target_starts_at is not null
        or target_ends_at is not null
        or target_source is not null then
        raise exception 'Tournament finals full planning payload is invalid'
          using errcode = '22023';
      end if;
      continue;
    end if;

    if target_play_date is null
      or target_starts_at is null
      or target_ends_at is null
      or target_ends_at <= target_starts_at
      or target_source not in ('generated', 'manual') then
      raise exception 'Tournament finals full planning payload is invalid'
        using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.tournament_resources as selected
      where selected.tournament_id = target_tournament.id
        and selected.resource_id = target_resource_id
    ) then
      raise exception 'Tournament finals planning resource is invalid'
        using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'finals'
        and generated.play_date = target_play_date
        and generated.starts_at = target_starts_at
        and generated.ends_at = target_ends_at
    ) then
      raise exception 'Tournament finals planning slot is invalid'
        using errcode = '22023';
    end if;

    select match.*
    into target_match
    from public.tournament_matches as match
    where match.tournament_id = target_tournament.id
      and match.series_id = target_series_id
      and match.phase = 'finals'
      and match.final_round_number = target_round_number
      and match.display_order = target_display_order;

    -- L'automatique reste fidèle aux disponibilités. En manuel l'admin peut
    -- forcer n'importe quel créneau Finals ; les conflits sportifs restent
    -- contrôlés séparément.
    if target_source = 'generated' and target_match.id is not null then
      if not exists (
        select 1
        from public.tournament_team_availability_slots as availability
        where availability.tournament_id = target_tournament.id
          and availability.team_id = target_match.team_a_id
          and availability.play_date = target_play_date
          and availability.starts_at = target_starts_at
          and availability.ends_at = target_ends_at
      ) or not exists (
        select 1
        from public.tournament_team_availability_slots as availability
        where availability.tournament_id = target_tournament.id
          and availability.team_id = target_match.team_b_id
          and availability.play_date = target_play_date
          and availability.starts_at = target_starts_at
          and availability.ends_at = target_ends_at
      ) then
        raise exception 'Tournament finals generated planning violates team availability'
          using errcode = 'P0001';
      end if;
    end if;

    update public.tournament_final_planning_nodes as node
    set
      resource_id = target_resource_id,
      play_date = target_play_date,
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      source = target_source,
      updated_at = now()
    where node.tournament_id = target_tournament.id
      and node.series_id = target_series_id
      and node.round_number = target_round_number
      and node.display_order = target_display_order;

    planned_count := planned_count + 1;
  end loop;

  -- L'ordre des étapes reste impératif, mais un trou « À programmer » n'empêche
  -- pas de réserver les étapes suivantes. On compare uniquement les nœuds déjà
  -- affectés de deux tours consécutifs.
  if exists (
    select 1
    from public.tournament_final_planning_nodes as current_node
    join public.tournament_final_planning_nodes as previous_node
      on previous_node.tournament_id = current_node.tournament_id
     and previous_node.series_id = current_node.series_id
     and previous_node.round_number = current_node.round_number - 1
    where current_node.tournament_id = target_tournament.id
      and current_node.resource_id is not null
      and previous_node.resource_id is not null
      and (current_node.play_date + current_node.starts_at)
        < (previous_node.play_date + previous_node.ends_at)
  ) then
    raise exception 'Tournament finals planning violates round order'
      using errcode = 'P0001';
  end if;

  -- Synchronise immédiatement les matchs sportifs déjà connus. Les futurs matchs
  -- hériteront du créneau via le trigger lors de leur création.
  for target_match in
    select match.*
    from public.tournament_matches as match
    where match.tournament_id = target_tournament.id
      and match.phase = 'finals'
      and exists (
        select 1
        from jsonb_array_elements(planning_values) as item
        where nullif(item->>'series_id', '')::uuid = match.series_id
          and nullif(item->>'round_number', '')::integer = match.final_round_number
          and nullif(item->>'display_order', '')::integer = match.display_order
      )
  loop
    perform public.sync_tournament_final_planning_node_to_match(target_match.id);
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
    'final_stage_full_planning_saved',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'nodes_submitted', jsonb_array_length(planning_values),
      'nodes_planned', planned_count
    ),
    auth.uid()
  );

  return planned_count;
end;
$$;

revoke all on function public.admin_save_tournament_final_full_planning(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.admin_save_tournament_final_full_planning(uuid, jsonb)
to authenticated;

commit;
