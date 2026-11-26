-- Explicit club-scoped team writes; only the full validation entry point is exposed.
CREATE OR REPLACE FUNCTION public.admin_save_tournament_team_for_club(target_club_id uuid, target_tournament_id uuid, target_team_id uuid, payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_tournament public.tournaments;
  current_team public.tournament_teams;
  target_series_id uuid := nullif(payload->>'series_id', '')::uuid;
  saved_team_id uuid;
  target_contact_email text := btrim(coalesce(payload->>'contact_email', ''));
  target_status text := coalesce(nullif(payload->>'status', ''), 'accepted');
  players jsonb := coalesce(payload->'players', '[]'::jsonb);
  availability_rules jsonb := coalesce(payload->'availability_rules', '[]'::jsonb);
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into current_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if current_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if current_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed'
  ) then
    raise exception 'Tournament teams are locked at this stage' using errcode = 'P0001';
  end if;

  if target_series_id is null
    or not exists (
      select 1
      from public.tournament_series as series
      where series.id = target_series_id
        and series.tournament_id = target_tournament_id
        and series.enabled
    ) then
    raise exception 'Tournament series is invalid' using errcode = '22023';
  end if;

  if target_contact_email = '' then
    raise exception 'Tournament registration fields are incomplete'
      using errcode = '22023';
  end if;

  if target_status not in ('pending', 'accepted') then
    raise exception 'Tournament team status is invalid' using errcode = '22023';
  end if;

  if target_team_id is not null then
    select team.*
    into current_team
    from public.tournament_teams as team
    where team.id = target_team_id
      and team.tournament_id = target_tournament_id
    for update;

    if current_team.id is null then
      raise exception 'Tournament team not found' using errcode = 'P0002';
    end if;
  end if;

  if target_status in ('pending', 'accepted')
    and not public.tournament_series_has_capacity(target_series_id, current_team.id) then
    raise exception 'Tournament series is full' using errcode = 'P0001';
  end if;

  if current_team.id is null then
    insert into public.tournament_teams (
      tournament_id,
      series_id,
      status,
      contact_email,
      contact_phone,
      comments,
      created_by,
      validated_by,
      validated_at
    )
    values (
      target_tournament_id,
      target_series_id,
      target_status::public.tournament_team_status,
      target_contact_email,
      btrim(coalesce(payload->>'contact_phone', '')),
      btrim(coalesce(payload->>'comments', '')),
      auth.uid(),
      case when target_status = 'accepted' then auth.uid() else null end,
      case when target_status = 'accepted' then now() else null end
    )
    returning id into saved_team_id;
  else
    saved_team_id := current_team.id;
    update public.tournament_teams
    set
      series_id = target_series_id,
      status = target_status::public.tournament_team_status,
      contact_email = target_contact_email,
      contact_phone = btrim(coalesce(payload->>'contact_phone', '')),
      comments = btrim(coalesce(payload->>'comments', '')),
      validated_by = case when target_status = 'accepted' then auth.uid() else null end,
      validated_at = case when target_status = 'accepted' then now() else null end,
      updated_at = now()
    where id = saved_team_id;
  end if;

  perform public.save_tournament_team_children(
    saved_team_id,
    target_tournament_id,
    target_club_id,
    players,
    availability_rules
  );

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament_id,
    case when current_team.id is null then 'team_added_by_admin' else 'team_updated_by_admin' end,
    current_tournament.status,
    current_tournament.status,
    jsonb_build_object('team_id', saved_team_id, 'series_id', target_series_id),
    auth.uid()
  );

  return saved_team_id;
end;
$function$;
revoke all on function public.admin_save_tournament_team_for_club(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_tournament_team_v2_for_club(target_club_id uuid, target_tournament_id uuid, target_team_id uuid, payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_tournament public.tournaments;
  availability_payload jsonb := coalesce(payload->'availability_slots', '[]'::jsonb);
  availability_item jsonb;
  availability_date date;
  availability_starts_at time;
  availability_ends_at time;
  availability_phase text;
  slot_key text;
  seen_keys text[] := '{}'::text[];
  pool_selected_count integer := 0;
  pool_weekend_count integer := 0;
  finals_selected_count integer := 0;
  saved_team_id uuid;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
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

  if target_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed'
  ) then
    raise exception 'Tournament teams are locked at this stage'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(availability_payload) <> 'array' then
    raise exception 'Tournament availability slots are invalid'
      using errcode = '22023';
  end if;

  for availability_item in
    select value from jsonb_array_elements(availability_payload)
  loop
    if coalesce(availability_item->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(availability_item->>'starts_at', '') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
      or coalesce(availability_item->>'ends_at', '') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then
      raise exception 'Tournament availability slots are invalid'
        using errcode = '22023';
    end if;

    availability_date := (availability_item->>'date')::date;
    availability_starts_at := (availability_item->>'starts_at')::time;
    availability_ends_at := (availability_item->>'ends_at')::time;
    slot_key := concat(
      availability_date,
      '|',
      availability_starts_at,
      '|',
      availability_ends_at
    );

    if slot_key = any(seen_keys) then
      raise exception 'Tournament availability slots are invalid'
        using errcode = '22023';
    end if;
    seen_keys := array_append(seen_keys, slot_key);

    select generated.phase
    into availability_phase
    from public.tournament_generated_slots(target_tournament.id) as generated
    where generated.play_date = availability_date
      and generated.starts_at = availability_starts_at
      and generated.ends_at = availability_ends_at
    limit 1;

    if availability_phase is null then
      raise exception 'Tournament availability slots are invalid'
        using errcode = '22023';
    end if;

    if availability_phase = 'pools' then
      pool_selected_count := pool_selected_count + 1;
      if extract(dow from availability_date)::integer in (0, 6) then
        pool_weekend_count := pool_weekend_count + 1;
      end if;
    else
      finals_selected_count := finals_selected_count + 1;
    end if;
  end loop;

  if pool_selected_count < target_tournament.minimum_availability_slots then
    raise exception 'Tournament availability minimum not reached'
      using errcode = '22023';
  end if;

  if pool_weekend_count < target_tournament.minimum_weekend_availability_slots then
    raise exception 'Tournament weekend availability minimum not reached'
      using errcode = '22023';
  end if;

  saved_team_id := public.admin_save_tournament_team_for_club(
    target_club_id,
    target_tournament_id,
    target_team_id,
    payload || jsonb_build_object('availability_rules', '[]'::jsonb)
  );

  delete from public.tournament_team_availability_slots
  where team_id = saved_team_id
    and tournament_id = target_tournament.id;

  insert into public.tournament_team_availability_slots (
    team_id,
    tournament_id,
    play_date,
    starts_at,
    ends_at
  )
  select
    saved_team_id,
    target_tournament.id,
    (item.value->>'date')::date,
    (item.value->>'starts_at')::time,
    (item.value->>'ends_at')::time
  from jsonb_array_elements(availability_payload) as item(value);

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
    'team_availability_slots_saved_by_admin',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'team_id', saved_team_id,
      'pool_slot_count', pool_selected_count,
      'pool_weekend_slot_count', pool_weekend_count,
      'finals_slot_count', finals_selected_count
    ),
    auth.uid()
  );

  return saved_team_id;
end;
$function$;
revoke all on function public.admin_save_tournament_team_v2_for_club(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_tournament_team_v3_for_club(target_club_id uuid, target_tournament_id uuid, target_team_id uuid, payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  saved_team_id uuid;
  player_item jsonb;
  item_member_id uuid;
  item_club_name text;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(payload->'players', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(payload->'players', '[]'::jsonb)) <> 2 then
    raise exception 'A tournament team must contain exactly two players'
      using errcode = '22023';
  end if;

  for player_item in
    select value from jsonb_array_elements(payload->'players')
  loop
    item_member_id := nullif(player_item->>'member_id', '')::uuid;
    item_club_name := btrim(coalesce(player_item->>'club_name', ''));
    if item_member_id is null
      and (item_club_name = '' or length(item_club_name) > 120) then
      raise exception 'Tournament player clubs are incomplete'
        using errcode = '22023';
    end if;
  end loop;

  saved_team_id := public.admin_save_tournament_team_v2_for_club(
    target_club_id,
    target_tournament_id,
    target_team_id,
    payload
  );

  update public.tournament_team_players as player
  set club_name = case
    when player.member_id is not null then coalesce((
      select club.name
      from public.club_members as member
      join public.clubs as club on club.id = member.club_id
      where member.id = player.member_id
      limit 1
    ), '')
    else coalesce((
      select btrim(item.value->>'club_name')
      from jsonb_array_elements(payload->'players') as item(value)
      where item.value->>'role' = player.role::text
      limit 1
    ), '')
  end
  where player.team_id = saved_team_id;

  if exists (
    select 1
    from public.tournament_team_players as player
    where player.team_id = saved_team_id
      and btrim(player.club_name) = ''
  ) then
    raise exception 'Tournament player clubs are incomplete'
      using errcode = '22023';
  end if;

  return saved_team_id;
end;
$function$;
revoke all on function public.admin_save_tournament_team_v3_for_club(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_tournament_team_v4_for_club(target_club_id uuid, target_tournament_id uuid, target_team_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_tournament public.tournaments;
  existing_team public.tournament_teams;
  previous_status public.tournament_status;
  requested_series_id uuid := nullif(payload->>'series_id', '')::uuid;
  requested_status text := coalesce(nullif(payload->>'status', ''), 'accepted');
  saved_team_id uuid;
  pools_invalidated boolean := false;
  preserve_pool_status boolean := false;
  structural_change boolean := false;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
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

  if target_tournament.status not in (
    'preparation',
    'configuration',
    'registrations_open',
    'registrations_closed',
    'pools_generated',
    'pools_validated'
  ) then
    raise exception 'Tournament teams cannot be changed after planning generation'
      using errcode = 'P0001';
  end if;

  previous_status := target_tournament.status;

  if target_team_id is not null then
    select team.*
    into existing_team
    from public.tournament_teams as team
    where team.id = target_team_id
      and team.tournament_id = target_tournament.id
    for update;

    if existing_team.id is null then
      raise exception 'Tournament team not found' using errcode = 'P0002';
    end if;
  end if;

  if previous_status in ('pools_generated', 'pools_validated') then
    structural_change := target_team_id is null
      or existing_team.series_id is distinct from requested_series_id
      or existing_team.status::text is distinct from requested_status;

    if structural_change then
      delete from public.tournament_pools
      where tournament_id = target_tournament.id;

      update public.tournaments
      set
        status = 'registrations_closed',
        updated_by = auth.uid(),
        updated_at = now()
      where id = target_tournament.id;

      pools_invalidated := true;
    else
      -- Les RPC historiques validées bloquent après registrations_closed.
      -- On ouvre uniquement une fenêtre transactionnelle interne, puis on
      -- restitue le statut de poules une fois la modification réussie.
      update public.tournaments
      set status = 'registrations_closed'
      where id = target_tournament.id;

      preserve_pool_status := true;
    end if;
  end if;

  saved_team_id := public.admin_save_tournament_team_v3_for_club(
    target_club_id,
    target_tournament_id,
    target_team_id,
    payload
  );

  if preserve_pool_status then
    update public.tournaments
    set
      status = previous_status,
      updated_by = auth.uid(),
      updated_at = now()
    where id = target_tournament.id;

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
      'team_updated_with_pools_preserved',
      previous_status,
      previous_status,
      jsonb_build_object('team_id', saved_team_id),
      auth.uid()
    );
  elsif pools_invalidated then
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
      'pools_invalidated_by_team_change',
      previous_status,
      'registrations_closed',
      jsonb_build_object(
        'team_id', saved_team_id,
        'reason', case
          when target_team_id is null then 'team_added'
          when existing_team.series_id is distinct from requested_series_id then 'series_changed'
          else 'team_status_changed'
        end
      ),
      auth.uid()
    );
  end if;

  return jsonb_build_object(
    'team_id', saved_team_id,
    'pools_invalidated', pools_invalidated
  );
end;
$function$;
revoke all on function public.admin_save_tournament_team_v4_for_club(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_save_tournament_team_v5_for_club(target_club_id uuid, target_tournament_id uuid, target_team_id uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  player_values jsonb := coalesce(payload->'players', '[]'::jsonb);
  player_item jsonb;
  normalized_players jsonb := '[]'::jsonb;
  seen_member_ids uuid[] := '{}'::uuid[];
  item_member_id uuid;
  item_role text;
  item_first_name text;
  item_last_name text;
  item_club_name text;
  item_email text;
  item_phone text;
  member_result record;
  normalized_payload jsonb;
  derived_email text;
  derived_phone text;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
      and tournament.club_id = target_club_id
  ) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(player_values) <> 'array'
    or jsonb_array_length(player_values) <> 2 then
    raise exception 'A tournament team must contain exactly two players'
      using errcode = '22023';
  end if;

  for player_item in
    select value from jsonb_array_elements(player_values)
  loop
    item_member_id := nullif(player_item->>'member_id', '')::uuid;
    item_role := coalesce(player_item->>'role', '');
    item_first_name := btrim(coalesce(player_item->>'first_name', ''));
    item_last_name := btrim(coalesce(player_item->>'last_name', ''));
    item_club_name := btrim(coalesce(player_item->>'club_name', ''));
    item_email := btrim(coalesce(player_item->>'email', ''));
    item_phone := btrim(coalesce(player_item->>'phone', ''));

    if item_member_id is not null then
      if item_member_id = any(seen_member_ids) then
        raise exception 'Tournament players are invalid' using errcode = '22023';
      end if;
      seen_member_ids := array_append(seen_member_ids, item_member_id);

      select
        member.id,
        member.first_name,
        member.last_name,
        member.email,
        member.phone,
        club.name as club_name
      into member_result
      from public.club_members as member
      join public.clubs as club on club.id = member.club_id
      where member.id = item_member_id
        and member.club_id = target_club_id
        and member.is_active;

      if not found then
        raise exception 'Tournament member is invalid' using errcode = '22023';
      end if;

      item_first_name := btrim(member_result.first_name);
      item_last_name := btrim(member_result.last_name);
      item_club_name := btrim(member_result.club_name);
      item_email := coalesce(nullif(btrim(member_result.email), ''), item_email);
      item_phone := coalesce(nullif(btrim(member_result.phone), ''), item_phone);
    end if;

    if item_role not in ('front', 'back')
      or item_first_name = ''
      or item_last_name = ''
      or item_club_name = '' then
      raise exception 'Tournament players are invalid' using errcode = '22023';
    end if;

    if item_email = '' or item_phone = '' then
      raise exception 'Tournament player contacts are incomplete'
        using errcode = '22023';
    end if;

    normalized_players := normalized_players || jsonb_build_array(
      jsonb_build_object(
        'member_id', item_member_id,
        'role', item_role,
        'first_name', item_first_name,
        'last_name', item_last_name,
        'club_name', item_club_name,
        'email', item_email,
        'phone', item_phone
      )
    );
  end loop;

  derived_email := btrim(coalesce(normalized_players->0->>'email', ''));
  derived_phone := btrim(coalesce(normalized_players->0->>'phone', ''));

  normalized_payload := payload || jsonb_build_object(
    'players', normalized_players,
    'contact_email', derived_email,
    'contact_phone', derived_phone
  );

  return public.admin_save_tournament_team_v4_for_club(
    target_club_id,
    target_tournament_id,
    target_team_id,
    normalized_payload
  );
end;
$function$;
revoke all on function public.admin_save_tournament_team_v5_for_club(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_save_tournament_team_v5_for_club(uuid, uuid, uuid, jsonb) to authenticated;

