begin;

-- Corrige l'ambiguïté PL/pgSQL entre la variable locale `round_number`
-- et la colonne homonyme de tournament_final_planning_nodes.
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
  current_round_number integer;
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
      on conflict on constraint tournament_final_planning_nodes_pkey
      do nothing;
    end if;

    bracket_size := main_bracket_size;
    current_round_number := 1;

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
        current_round_number,
        generated.display_order
      from generate_series(0, match_count - 1) as generated(display_order)
      on conflict on constraint tournament_final_planning_nodes_pkey
      do nothing;

      bracket_size := bracket_size / 2;
      current_round_number := current_round_number + 1;
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

commit;
