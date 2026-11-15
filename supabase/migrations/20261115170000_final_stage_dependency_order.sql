-- Sports dependencies follow actual knockout-bracket ancestry, not merely round numbers.
-- Returns TRUE only if the earlier match feeds the later match (directly or transitively).
create or replace function public.tournament_final_node_depends_on(
  target_series_id uuid,
  later_round_number integer,
  later_display_order integer,
  earlier_round_number integer,
  earlier_display_order integer
) returns boolean
language plpgsql stable
security definer set search_path=''
as $function$
declare
  qualifying integer;
  cross_pools boolean;
  main_size integer := 1;
  direct_entrants integer;
  first_round_index integer;
  preliminary_main_seed integer;
  seeded_order integer[];
  position_in_order integer;
begin
  if later_round_number is null or earlier_round_number is null
    or earlier_round_number >= later_round_number
    or earlier_round_number < 0 or earlier_display_order < 0
    or later_display_order < 0 then
    return false;
  end if;

  select s.finals_qualifier_count,s.finals_cross_pools
  into qualifying,cross_pools from public.tournament_series s
  where s.id=target_series_id;
  if qualifying is null or qualifying < 2 then return false; end if;

  while main_size*2<=qualifying loop
    main_size:=main_size*2;
  end loop;
  direct_entrants:=2*main_size-qualifying;

  if earlier_round_number = 0 then
    if direct_entrants=qualifying then return false; end if;
    if earlier_display_order >= qualifying-main_size then return false; end if;
    preliminary_main_seed:=direct_entrants+1+earlier_display_order;
    seeded_order:=case
      when cross_pools and qualifying=6 then array[1,3,2,4]::integer[]
      else public.tournament_final_seed_order(main_size)
    end;
    position_in_order:=array_position(seeded_order,preliminary_main_seed);
    if position_in_order is null then return false; end if;
    first_round_index:=(position_in_order-1)/2;
    return floor(first_round_index::numeric/power(2::numeric,later_round_number-1))::integer
      = later_display_order;
  end if;

  return floor(
    earlier_display_order::numeric/
    power(2::numeric,later_round_number-earlier_round_number)
  )::integer = later_display_order;
end;
$function$;

revoke all on function public.tournament_final_node_depends_on(
  uuid,integer,integer,integer,integer
) from public,anon;
grant execute on function public.tournament_final_node_depends_on(
  uuid,integer,integer,integer,integer
) to authenticated;


CREATE OR REPLACE FUNCTION public.admin_save_tournament_final_full_planning(target_tournament_id uuid, payload jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Only actual bracket ancestry is chronological: independent matches
  -- from different branches may overlap or happen out of round order.
  if exists (
    select 1
    from public.tournament_final_planning_nodes as later_node
    join public.tournament_final_planning_nodes as earlier_node
      on earlier_node.tournament_id=later_node.tournament_id
     and earlier_node.series_id=later_node.series_id
     and earlier_node.round_number<later_node.round_number
    where later_node.tournament_id=target_tournament.id
      and later_node.resource_id is not null
      and earlier_node.resource_id is not null
      and public.tournament_final_node_depends_on(
        later_node.series_id,
        later_node.round_number,
        later_node.display_order,
        earlier_node.round_number,
        earlier_node.display_order
      )
      and (later_node.play_date+later_node.starts_at)
          < (earlier_node.play_date+earlier_node.ends_at)
  ) then
    raise exception 'Tournament finals planning violates dependent match order'
      using errcode='P0001';
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_tournament_final_manual_datetime(target_tournament_id uuid, target_series_id uuid, target_round_number integer, target_display_order integer, target_resource_id uuid, target_play_date date, target_starts_at time without time zone, target_ends_at time without time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  selected_club uuid := public.admin_current_club_id();
  selected_tournament public.tournaments;
  selected_node public.tournament_final_planning_nodes;
  selected_match public.tournament_matches;
  selected_timezone text;
  from_instant timestamptz;
  until_instant timestamptz;
begin
  if auth.uid() is null
    or not public.has_club_permission(selected_club, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select t.* into selected_tournament
  from public.tournaments t
  where t.id = target_tournament_id and t.club_id = selected_club
  for update;
  if selected_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  select n.* into selected_node
  from public.tournament_final_planning_nodes n
  where n.tournament_id = target_tournament_id
    and n.series_id = target_series_id
    and n.round_number = target_round_number
    and n.display_order = target_display_order
  for update;
  if selected_node.tournament_id is null then
    raise exception 'Finals position not found' using errcode = 'P0002';
  end if;

  select m.* into selected_match
  from public.tournament_matches m
  where m.tournament_id = target_tournament_id
    and m.series_id = target_series_id
    and m.phase = 'finals'
    and m.final_round_number = target_round_number
    and m.display_order = target_display_order;

  if selected_match.id is not null and (
    exists(select 1 from public.tournament_match_events e
      where e.match_id = selected_match.id)
    or exists(select 1 from public.tournament_match_results r
      where r.match_id = selected_match.id and r.status = 'validated')
  ) then
    raise exception 'Published or completed match cannot be moved'
      using errcode = 'P0001';
  end if;

  if target_play_date is null
    or selected_tournament.finals_starts_on is null
    or selected_tournament.finals_ends_on is null
    or target_play_date < selected_tournament.finals_starts_on
    or target_play_date > selected_tournament.finals_ends_on
    or target_starts_at is null
    or target_ends_at is null
    or target_ends_at <= target_starts_at
    or target_ends_at - target_starts_at < interval '30 minutes'
    or target_ends_at - target_starts_at > interval '5 hours' then
    raise exception 'Date outside final stage or invalid duration'
      using errcode = '22023';
  end if;

  select coalesce(rr.timezone, 'Europe/Paris')
  into selected_timezone
  from public.reservable_resources rr
  join public.tournament_resources tr
    on tr.resource_id = rr.id
  where rr.id = target_resource_id
    and tr.tournament_id = target_tournament_id
    and rr.club_id = selected_club;
  if selected_timezone is null then
    raise exception 'Resource is not part of this tournament'
      using errcode = '22023';
  end if;

  from_instant := timezone(selected_timezone, target_play_date + target_starts_at);
  until_instant := timezone(selected_timezone, target_play_date + target_ends_at);

  -- A provisional bracket position also reserves its court, even when the
  -- teams in a future round are still unknown.
  if exists (
    select 1 from public.tournament_final_planning_nodes n
    where n.resource_id = target_resource_id
      and n.play_date = target_play_date
      and n.starts_at < target_ends_at
      and n.ends_at > target_starts_at
      and not (
        n.tournament_id = target_tournament_id
        and n.series_id = target_series_id
        and n.round_number = target_round_number
        and n.display_order = target_display_order
      )
  ) then
    raise exception 'Court occupied by another finals position'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.tournament_match_planning mp
    where mp.resource_id = target_resource_id
      and mp.play_date = target_play_date
      and mp.starts_at < target_ends_at
      and mp.ends_at > target_starts_at
      and (selected_match.id is null or mp.match_id <> selected_match.id)
  ) then
    raise exception 'Court occupied by another tournament match'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.reservations r
    where r.resource_id = target_resource_id
      and r.status::text in ('pending', 'confirmed', 'completed')
      and r.starts_at < until_instant
      and r.ends_at > from_instant
  ) then
    raise exception 'Court occupied by an existing reservation'
      using errcode = 'P0001';
  end if;

  -- Includes published championships, closures and other event blocks,
  -- not just ordinary user reservations.
  if exists (
    select 1 from public.calendar_occupations o
    where o.resource_id = target_resource_id
      and o.cancelled_at is null
      and o.starts_at < until_instant
      and o.ends_at > from_instant
  ) then
    raise exception 'Court occupied by another calendar event'
      using errcode = 'P0001';
  end if;

  -- Only rounds on this fixture's actual bracket path are ordered.
  -- An independent 1/8 may therefore precede an unrelated preliminary.
  if exists (
    select 1 from public.tournament_final_planning_nodes n
    where n.tournament_id=target_tournament_id
      and n.series_id=target_series_id
      and n.resource_id is not null
      and n.round_number<>target_round_number
      and (
        (
          n.round_number<target_round_number
          and public.tournament_final_node_depends_on(
            target_series_id,target_round_number,target_display_order,
            n.round_number,n.display_order
          )
          and n.play_date+n.ends_at>target_play_date+target_starts_at
        )
        or (
          n.round_number>target_round_number
          and public.tournament_final_node_depends_on(
            target_series_id,n.round_number,n.display_order,
            target_round_number,target_display_order
          )
          and n.play_date+n.starts_at<target_play_date+target_ends_at
        )
      )
  ) then
    raise exception 'Date conflicts with an actual dependent knockout match'
      using errcode='P0001';
  end if;

  update public.tournament_final_planning_nodes n
  set resource_id = target_resource_id,
      play_date = target_play_date,
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      source = 'manual',
      updated_at = now()
  where n.tournament_id = target_tournament_id
    and n.series_id = target_series_id
    and n.round_number = target_round_number
    and n.display_order = target_display_order;

  if selected_match.id is not null then
    perform public.sync_tournament_final_planning_node_to_match(selected_match.id);
  end if;

  insert into public.tournament_audit_log (
    tournament_id, action, before_status, after_status, payload, created_by
  ) values (
    target_tournament_id,
    'final_stage_exceptional_manual_slot',
    selected_tournament.status, selected_tournament.status,
    jsonb_build_object(
      'series_id', target_series_id,
      'round_number', target_round_number,
      'display_order', target_display_order,
      'resource_id', target_resource_id,
      'play_date', target_play_date,
      'starts_at', target_starts_at,
      'ends_at', target_ends_at
    ),
    auth.uid()
  );
end;
$function$;
