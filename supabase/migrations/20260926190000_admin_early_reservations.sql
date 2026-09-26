begin;

create or replace function public.admin_assert_reservation_slot_allowed(
  target_resource_id uuid,
  target_user_id uuid,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  excluded_reservation_id uuid default null
)
returns table (
  customer_type public.reservation_customer_type,
  price_cents integer,
  booking_opens_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_active boolean;
  resource_timezone text;
  settings public.reservation_settings%rowtype;
  terms record;
  championship_access record;
  active_count integer;
  calculated_booking_opens_at timestamptz;
  local_start timestamp;
  local_end timestamp;
  regular_opening_allowed boolean;
  released_permanent_at timestamptz;
  effective_advance_hours integer;
  effective_max_active integer;
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if target_ends_at <= target_starts_at then
    raise exception 'La fin du créneau doit être postérieure au début' using errcode = '22007';
  end if;

  select is_active, timezone
  into resource_active, resource_timezone
  from public.reservable_resources
  where id = target_resource_id;

  if resource_active is distinct from true then
    raise exception 'La ressource demandée est indisponible' using errcode = 'P0001';
  end if;

  select * into strict settings from public.reservation_settings where id;

  if extract(epoch from (target_ends_at - target_starts_at))::integer / 60
    <> settings.default_duration_minutes then
    raise exception 'La durée du créneau ne respecte pas la durée configurée' using errcode = 'P0001';
  end if;

  local_start := target_starts_at at time zone resource_timezone;
  local_end := target_ends_at at time zone resource_timezone;

  select exists (
    select 1
    from public.resource_opening_hours as hours
    where hours.resource_id = target_resource_id
      and hours.weekday = extract(dow from local_start)::smallint
      and hours.is_open
      and hours.opens_at <= local_start::time
      and hours.closes_at >= local_end::time
      and mod(
        extract(epoch from (local_start::time - hours.opens_at))::bigint,
        settings.booking_step_minutes::bigint * 60
      ) = 0
  ) into regular_opening_allowed;

  select occurrence.released_at
  into released_permanent_at
  from public.permanent_slot_occurrences as occurrence
  join public.permanent_slots as permanent_slot
    on permanent_slot.id = occurrence.permanent_slot_id and permanent_slot.is_active
  join public.calendar_occupations as private_occupation
    on private_occupation.id = occurrence.occupation_id
  where permanent_slot.resource_id = target_resource_id
    and occurrence.status = 'released'::public.permanent_slot_occurrence_status
    and private_occupation.starts_at = target_starts_at
    and private_occupation.ends_at = target_ends_at
  order by occurrence.released_at desc
  limit 1;

  select * into strict championship_access
  from public.get_championship_reservation_access(
    target_resource_id, target_user_id, target_starts_at, target_ends_at
  );

  if local_start::date <> local_end::date
    or (
      not regular_opening_allowed
      and not championship_access.is_priority
      and released_permanent_at is null
    ) then
    raise exception 'Ce créneau se situe hors des horaires de réservation' using errcode = 'P0001';
  end if;

  select * into strict terms
  from public.get_reservation_terms(target_user_id, target_starts_at);

  effective_advance_hours := coalesce(championship_access.advance_hours, terms.advance_hours);
  effective_max_active := coalesce(championship_access.max_active_reservations, terms.max_active_reservations);

  calculated_booking_opens_at := public.get_reservation_booking_opens_at(
    target_starts_at, effective_advance_hours
  );
  if released_permanent_at is not null then
    calculated_booking_opens_at := least(calculated_booking_opens_at, released_permanent_at);
  end if;

  if now() + make_interval(mins => settings.minimum_notice_minutes) >= target_starts_at then
    raise exception 'Le délai minimum avant réservation n''est pas respecté' using errcode = 'P0001';
  end if;

  select count(*) into active_count
  from public.reservations
  where user_id = target_user_id
    and id is distinct from excluded_reservation_id
    and status in ('pending', 'confirmed')
    and ends_at > now();

  if active_count >= effective_max_active then
    raise exception 'Le nombre maximal de réservations actives est atteint' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.calendar_occupations
    where resource_id = target_resource_id
      and cancelled_at is null
      and (excluded_reservation_id is null or reservation_id is distinct from excluded_reservation_id)
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(target_starts_at, target_ends_at, '[)')
  ) then
    raise exception 'Ce créneau est déjà occupé' using errcode = '23P01';
  end if;

  return query select terms.customer_type, terms.price_cents, calculated_booking_opens_at;
end;
$$;

revoke all on function public.admin_assert_reservation_slot_allowed(uuid,uuid,timestamptz,timestamptz,uuid)
from public, anon, authenticated;
grant execute on function public.admin_assert_reservation_slot_allowed(uuid,uuid,timestamptz,timestamptz,uuid)
to authenticated;

create or replace function public.admin_create_reservation_for_user(
  target_user_id uuid,
  target_resource_id uuid,
  target_starts_at timestamptz
)
returns public.reservations
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  settings public.reservation_settings%rowtype;
  target_ends_at timestamptz;
  terms record;
  created public.reservations;
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;
  if target_user_id is null or not exists(select 1 from public.profiles where id = target_user_id) then
    raise exception 'Un compte utilisateur existant est obligatoire' using errcode = '22023';
  end if;

  select * into strict settings from public.reservation_settings where id;
  target_ends_at := target_starts_at + make_interval(mins => settings.default_duration_minutes);

  select * into strict terms
  from public.admin_assert_reservation_slot_allowed(
    target_resource_id, target_user_id, target_starts_at, target_ends_at, null
  );

  insert into public.reservations(
    resource_id,user_id,customer_type,status,starts_at,ends_at,price_cents,created_by,updated_by
  ) values(
    target_resource_id,target_user_id,terms.customer_type,'confirmed',
    target_starts_at,target_ends_at,terms.price_cents,actor,actor
  ) returning * into created;

  insert into public.calendar_occupations(
    resource_id,occupation_type,reservation_id,title,starts_at,ends_at,created_by,updated_by
  ) values(
    target_resource_id,'reservation',created.id,'Réservation',
    target_starts_at,target_ends_at,actor,actor
  );

  insert into public.reservation_audit_log(reservation_id,action,actor_id,new_data)
  values(
    created.id,
    case when now() < terms.booking_opens_at then 'admin_early_created_for_user' else 'admin_created_for_user' end,
    actor,
    to_jsonb(created) || jsonb_build_object('public_visible_at', terms.booking_opens_at)
  );

  return created;
exception when exclusion_violation then
  raise exception 'Ce créneau est déjà occupé' using errcode = '23P01';
end;
$$;

drop function if exists public.admin_list_available_reservation_slots(uuid,date,uuid);

create function public.admin_list_available_reservation_slots(
  target_resource_id uuid,
  target_date date,
  excluded_reservation_id uuid default null
)
returns table(starts_at timestamptz, ends_at timestamptz, booking_opens_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  return query
  select slot.starts_at, slot.ends_at, slot.booking_opens_at
  from public.list_available_slots(target_resource_id, target_date, target_date) slot
  where (
    slot.status in ('available', 'locked')
    or excluded_reservation_id is not null
  )
  and not exists (
    select 1
    from public.calendar_occupations occupation
    where occupation.resource_id = target_resource_id
      and occupation.cancelled_at is null
      and (excluded_reservation_id is null or occupation.reservation_id is distinct from excluded_reservation_id)
      and occupation.starts_at < slot.ends_at
      and occupation.ends_at > slot.starts_at
  )
  order by slot.starts_at;
end;
$$;

create or replace function public.admin_preview_reservation(
  target_user_id uuid,
  target_resource_id uuid,
  target_starts_at timestamptz
)
returns table(
  customer_type public.reservation_customer_type,
  price_cents integer,
  ends_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  settings public.reservation_settings%rowtype;
  terms record;
  calculated_end timestamptz;
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;
  if target_user_id is null or not exists(select 1 from public.profiles where id = target_user_id) then
    raise exception 'Un compte utilisateur existant est obligatoire' using errcode = '22023';
  end if;

  select * into strict settings from public.reservation_settings where id;
  calculated_end := target_starts_at + make_interval(mins => settings.default_duration_minutes);

  select * into strict terms
  from public.admin_assert_reservation_slot_allowed(
    target_resource_id,target_user_id,target_starts_at,calculated_end,null
  );

  return query select terms.customer_type, terms.price_cents, calculated_end;
end;
$$;

drop function if exists public.list_available_slots_v3(uuid, date, date);

create function public.list_available_slots_v3(
  target_resource_id uuid,
  range_start date,
  range_end date
)
returns table (
  resource_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  booking_opens_at timestamptz,
  booked_by_name text,
  occupation_type text,
  display_color text,
  reservation_access text,
  result_display text
)
language sql stable security definer set search_path = ''
as $$
  select
    slot.resource_id,
    slot.starts_at,
    slot.ends_at,
    case
      when slot.occupation_type = 'reservation'
        and slot.booking_opens_at is not null
        and now() < slot.booking_opens_at
      then 'locked'
      else slot.status
    end,
    slot.booking_opens_at,
    case
      when slot.occupation_type = 'reservation'
        and slot.booking_opens_at is not null
        and now() < slot.booking_opens_at
      then null
      else coalesce(championship_slot.display_name, slot.booked_by_name)
    end,
    case
      when slot.occupation_type = 'reservation'
        and slot.booking_opens_at is not null
        and now() < slot.booking_opens_at
      then null
      when championship_slot.match_id is not null then 'championship_match'
      else slot.occupation_type
    end,
    case
      when slot.occupation_type = 'reservation'
        and slot.booking_opens_at is not null
        and now() < slot.booking_opens_at
      then null
      else coalesce(championship_slot.display_color, slot.display_color)
    end,
    slot.reservation_access,
    case
      when slot.occupation_type = 'reservation'
        and slot.booking_opens_at is not null
        and now() < slot.booking_opens_at
      then null
      else coalesce(championship_slot.result_display, tournament_slot.result_display)
    end
  from public.list_available_slots_v2(target_resource_id, range_start, range_end) as slot
  left join lateral (
    select
      match.id as match_id,
      concat_ws(E'
',
        championship.name,
        division.name,
        coalesce(nullif((
          select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.last_name, player.first_name, player.licence_number)
          from public.championship_team_players as team_player
          join public.championship_players as player on player.id = team_player.player_id
          where team_player.team_id = team1.id
        ), ''), team1.source_label),
        concat('vs ', coalesce(nullif((
          select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.last_name, player.first_name, player.licence_number)
          from public.championship_team_players as team_player
          join public.championship_players as player on player.id = team_player.player_id
          where team_player.team_id = team2.id
        ), ''), team2.source_label))
      ) as display_name,
      coalesce(division.display_color, '#D5B04C') as display_color,
      case
        when match.status = 'played' and match.score_team1 is not null and match.score_team2 is not null then
          concat(
            coalesce(nullif((
              select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.last_name, player.first_name, player.licence_number)
              from public.championship_team_players as team_player
              join public.championship_players as player on player.id = team_player.player_id
              where team_player.team_id = team1.id
            ), ''), team1.source_label),
            '  ', match.score_team1, ' – ', match.score_team2, '  ',
            coalesce(nullif((
              select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.last_name, player.first_name, player.licence_number)
              from public.championship_team_players as team_player
              join public.championship_players as player on player.id = team_player.player_id
              where team_player.team_id = team2.id
            ), ''), team2.source_label)
          )
        else null
      end as result_display
    from public.reservations as reservation
    join public.championship_matches as match on match.id = reservation.championship_match_id
    join public.championship_divisions as division on division.id = match.division_id
    join public.championships as championship on championship.id = division.championship_id
    join public.championship_teams as team1 on team1.id = match.team1_id
    join public.championship_teams as team2 on team2.id = match.team2_id
    where reservation.resource_id = slot.resource_id
      and reservation.status in ('pending', 'confirmed')
      and reservation.starts_at < slot.ends_at and reservation.ends_at > slot.starts_at
    order by reservation.created_at desc limit 1
  ) as championship_slot on true
  left join lateral (
    select
      case when result.status = 'validated' then
        concat(
          coalesce(nullif((
            select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.display_order, player.id)
            from public.tournament_team_players as player where player.team_id = match.team_a_id
          ), ''), 'Équipe 1'),
          '  ',
          coalesce(
            case
              when result.team_a_points is not null and result.team_b_points is not null
                then concat(result.team_a_points, ' – ', result.team_b_points)
              when result.team_a_sets is not null and result.team_b_sets is not null
                then concat(result.team_a_sets, ' – ', result.team_b_sets)
            end,
            ''
          ),
          '  ',
          coalesce(nullif((
            select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.display_order, player.id)
            from public.tournament_team_players as player where player.team_id = match.team_b_id
          ), ''), 'Équipe 2')
        )
      end as result_display
    from public.calendar_occupations as occupation
    join public.event_resources as event_resource on event_resource.calendar_occupation_id = occupation.id
    join public.tournament_match_events as match_event on match_event.event_id = event_resource.event_id
    join public.tournament_matches as match on match.id = match_event.match_id
    left join public.tournament_match_results as result on result.match_id = match.id
    where occupation.resource_id = slot.resource_id
      and occupation.cancelled_at is null
      and occupation.starts_at = slot.starts_at
      and occupation.ends_at = slot.ends_at
    limit 1
  ) as tournament_slot on true
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots_v3(uuid, date, date) from public, anon, authenticated;
grant execute on function public.list_available_slots_v3(uuid, date, date) to anon, authenticated;

commit;
