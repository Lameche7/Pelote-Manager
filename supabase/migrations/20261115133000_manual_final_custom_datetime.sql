-- Club-admin override: a final-stage manual placement may be on a Saturday
-- or outside the regular published slot grid. No changes to automatic candidates.
-- All validations are performed server-side under the existing club permission.
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

    -- Automatic scheduling remains constrained to generated finals slots.
    -- Manual club-admin overrides may use arbitrary daytime/weekend hours,
    -- but only inside this tournament's finals date range.
    if target_source = 'generated' and not exists (
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

    if target_play_date < target_tournament.finals_starts_on
       or target_play_date > target_tournament.finals_ends_on then
      raise exception 'Manual date must stay within this tournament finals period'
        using errcode='22023';
    end if;

    -- Overlap (not just exact equality): include other series, already assigned
    -- planning nodes, other tournaments, and reservations sharing this court.
    if exists(
      select 1 from public.tournament_final_planning_nodes n
      where n.resource_id=target_resource_id
        and n.play_date=target_play_date
        and n.starts_at < target_ends_at
        and n.ends_at > target_starts_at
    ) then
      raise exception 'Court occupied by another final-stage match'
        using errcode='P0001';
    end if;

    if exists(
      select 1 from public.tournament_match_planning mp
      join public.tournament_matches m on m.id=mp.match_id
      where mp.resource_id=target_resource_id
        and mp.play_date=target_play_date
        and mp.starts_at < target_ends_at
        and mp.ends_at > target_starts_at
        and not (
          m.tournament_id=target_tournament_id and
          m.phase='finals' and exists(
            select 1 from public.tournament_final_planning_nodes n
            where n.tournament_id=target_tournament_id
              and n.series_id=m.series_id
              and n.round_number=m.final_round_number
              and n.display_order=m.display_order
              and n.resource_id is not null
          )
        )
    ) then
      raise exception 'Court occupied by another tournament match'
        using errcode='P0001';
    end if;

    if exists(
      select 1 from public.reservations res
      join public.reservable_resources resource on resource.id=res.resource_id
      where res.resource_id=target_resource_id
        and res.status::text in ('pending','confirmed','completed')
        and res.starts_at <
          public.tournament_planning_starts_at(target_play_date,target_ends_at,resource.timezone)
        and res.ends_at >
          public.tournament_planning_starts_at(target_play_date,target_starts_at,resource.timezone)
    ) then
      raise exception 'Court occupied by an existing reservation'
        using errcode='P0001';
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
$function$
;

revoke all on function public.admin_save_tournament_final_full_planning(uuid,jsonb)
  from public, anon;
grant execute on function public.admin_save_tournament_final_full_planning(uuid,jsonb)
  to authenticated;
