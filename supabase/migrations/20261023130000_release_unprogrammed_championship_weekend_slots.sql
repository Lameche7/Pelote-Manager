begin;
create or replace function public.weekend_championship_release_at(target_resource_id uuid,target_starts_at timestamptz,target_ends_at timestamptz)
returns timestamptz language sql stable security definer set search_path='' as $$
 select case
   when extract(isodow from (target_starts_at at time zone r.timezone)) in (6,7)
    and (target_starts_at at time zone r.timezone)::date=(target_ends_at at time zone r.timezone)::date
    and exists (select 1 from public.championship_reservation_settings p join public.championship_reservation_resources rr on rr.club_id=p.club_id
      where p.club_id=r.club_id and p.enabled and rr.resource_id=r.id)
    and exists (select 1 from public.championship_reservation_windows w where w.club_id=r.club_id
      and w.weekday=extract(isodow from (target_starts_at at time zone r.timezone))::smallint
      and w.opens_at <= (target_starts_at at time zone r.timezone)::time
      and w.closes_at >= (target_ends_at at time zone r.timezone)::time)
   then (((target_starts_at at time zone r.timezone)::date
      - (extract(isodow from (target_starts_at at time zone r.timezone))::int - 4)) + time '08:00') at time zone r.timezone
 end
 from public.reservable_resources r where r.id=target_resource_id and r.is_active
$$;
revoke all on function public.weekend_championship_release_at(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.weekend_championship_release_at(uuid,timestamptz,timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.get_championship_reservation_access(target_resource_id uuid, target_user_id uuid, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone)
 RETURNS TABLE(is_priority boolean, advance_hours integer, max_active_reservations integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_club_id uuid;
  target_timezone text;
  local_start timestamp;
  local_end timestamp;
  step_minutes integer;
  policy public.championship_reservation_settings%rowtype;
begin
  select resource.club_id, resource.timezone
  into target_club_id, target_timezone
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null or target_user_id is null then
    return query select false, null::integer, null::integer;
    return;
  end if;

  select *
  into policy
  from public.championship_reservation_settings as setting
  where setting.club_id = target_club_id
    and setting.enabled;

  if policy.club_id is null
    or not exists (
      select 1
      from public.championship_reservation_resources as selected_resource
      where selected_resource.club_id = target_club_id
        and selected_resource.resource_id = target_resource_id
    )
    or not public.championship_reservation_player_is_eligible(
      target_club_id,
      target_user_id
    )
  then
    return query select false, null::integer, null::integer;
    return;
  end if;

  -- Priority ends Thursday at 08:00 before the corresponding weekend.
  if now() >= coalesce(public.weekend_championship_release_at(target_resource_id,target_starts_at,target_ends_at),'infinity'::timestamptz) then
    return query select false, null::integer, null::integer;
    return;
  end if;
  local_start := target_starts_at at time zone target_timezone;
  local_end := target_ends_at at time zone target_timezone;

  if local_start::date <> local_end::date then
    return query select false, null::integer, null::integer;
    return;
  end if;

  select settings.booking_step_minutes
  into step_minutes
  from public.club_reservation_settings as settings
  where settings.club_id = target_club_id;

  if not exists (
    select 1
    from public.championship_reservation_windows as priority_window
    where priority_window.club_id = target_club_id
      and priority_window.weekday = extract(isodow from local_start)::smallint
      and priority_window.opens_at <= local_start::time
      and priority_window.closes_at >= local_end::time
      and mod(
        extract(epoch from (local_start::time - priority_window.opens_at))::bigint,
        step_minutes::bigint * 60
      ) = 0
  ) then
    return query select false, null::integer, null::integer;
    return;
  end if;

  return query select
    true,
    policy.advance_days * 24,
    policy.max_active_reservations;
end;
$function$

CREATE OR REPLACE FUNCTION public.list_available_slots(target_resource_id uuid, range_start date, range_end date)
 RETURNS TABLE(resource_id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, booking_opens_at timestamp with time zone, booked_by_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with resource_config as (
    select
      resource.id,
      resource.club_id,
      resource.timezone,
      settings.default_duration_minutes,
      settings.booking_step_minutes
    from public.reservable_resources as resource
    join public.club_reservation_settings as settings
      on settings.club_id = resource.club_id
    where resource.id = target_resource_id
      and resource.is_active
  ),
  calendar_days as (
    select day_value::date as calendar_date
    from generate_series(range_start, range_end, interval '1 day') as day_value
  ),
  regular_periods as (
    select
      config.id as resource_id,
      config.timezone,
      config.default_duration_minutes,
      config.booking_step_minutes,
      day.calendar_date,
      hours.opens_at,
      hours.closes_at
    from resource_config as config
    cross join calendar_days as day
    join public.resource_opening_hours as hours
      on hours.resource_id = config.id
     and hours.weekday = extract(dow from day.calendar_date)::smallint
     and hours.is_open
  ),
  championship_periods as (
    select
      config.id as resource_id,
      config.timezone,
      config.default_duration_minutes,
      config.booking_step_minutes,
      day.calendar_date,
      priority_window.opens_at,
      priority_window.closes_at
    from resource_config as config
    cross join calendar_days as day
    join public.championship_reservation_settings as policy
      on policy.club_id = config.club_id
     and policy.enabled
    join public.championship_reservation_resources as selected_resource
      on selected_resource.club_id = config.club_id
     and selected_resource.resource_id = config.id
    join public.championship_reservation_windows as priority_window
      on priority_window.club_id = config.club_id
     and priority_window.weekday = extract(isodow from day.calendar_date)::smallint
    where (
      public.championship_reservation_player_is_eligible(config.club_id,auth.uid())
      or now() >= coalesce(
        public.weekend_championship_release_at(
          config.id,
          (day.calendar_date + priority_window.opens_at) at time zone config.timezone,
          (day.calendar_date + priority_window.closes_at) at time zone config.timezone
        ), 'infinity'::timestamptz
      )
    )
  ),
  opening_periods as (
    select * from regular_periods
    union
    select * from championship_periods
  ),
  generated_slots as (
    select distinct
      period.resource_id,
      (slot_local at time zone period.timezone) as starts_at,
      (
        slot_local + make_interval(mins => period.default_duration_minutes)
      ) at time zone period.timezone as ends_at
    from opening_periods as period
    cross join lateral generate_series(
      period.calendar_date + period.opens_at,
      period.calendar_date + period.closes_at
        - make_interval(mins => period.default_duration_minutes),
      make_interval(mins => period.booking_step_minutes)
    ) as slot_local
  ),
  slots_with_terms as (
    select
      slot.*,
      case when access.is_priority then public.get_reservation_booking_opens_at(slot.starts_at,access.advance_hours)
      else coalesce(public.weekend_championship_release_at(slot.resource_id,slot.starts_at,slot.ends_at),
        public.get_reservation_booking_opens_at(slot.starts_at,terms.advance_hours))
      end as booking_opens_at
    from generated_slots as slot
    cross join lateral public.get_reservation_terms_for_resource(
      slot.resource_id,
      auth.uid(),
      slot.starts_at
    ) as terms
    cross join lateral public.get_championship_reservation_access(
      slot.resource_id,
      auth.uid(),
      slot.starts_at,
      slot.ends_at
    ) as access
  ),
  scheduled_slots as (
    select
      slot.resource_id,
      slot.starts_at,
      slot.ends_at,
      case
        when occupation.id is not null then 'occupied'
        when now() < slot.booking_opens_at then 'locked'
        else 'available'
      end as status,
      slot.booking_opens_at,
      case
        when occupation.occupation_type = 'reservation'::public.occupation_type then
          coalesce(
            nullif(btrim(concat_ws(' ', club_member.first_name, club_member.last_name)), ''),
            nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
            nullif(btrim(profile.display_name), ''),
            nullif(btrim(reservation.guest_name), ''),
            'Réservation'
          )
        when occupation.id is not null then
          coalesce(nullif(btrim(occupation.title), ''), 'Indisponibilité exceptionnelle')
        else null
      end as booked_by_name
    from slots_with_terms as slot
    join public.reservable_resources as slot_resource
      on slot_resource.id = slot.resource_id
    left join public.calendar_occupations as occupation
      on occupation.resource_id = slot.resource_id
     and occupation.cancelled_at is null
     and occupation.starts_at = slot.starts_at
     and occupation.ends_at = slot.ends_at
    left join public.reservations as reservation on reservation.id = occupation.reservation_id
    left join public.profiles as profile on profile.id = reservation.user_id
    left join public.club_members as club_member on club_member.id = public.profile_club_member_id(profile.id, slot_resource.club_id)
    where not exists (
      select 1
      from public.calendar_occupations as overlapping_occupation
      where overlapping_occupation.resource_id = slot.resource_id
        and overlapping_occupation.cancelled_at is null
        and overlapping_occupation.starts_at < slot.ends_at
        and overlapping_occupation.ends_at > slot.starts_at
        and not (
          overlapping_occupation.starts_at = slot.starts_at
          and overlapping_occupation.ends_at = slot.ends_at
        )
    )
  ),
  occupations_outside_schedule as (
    select
      occupation.resource_id,
      occupation.starts_at,
      occupation.ends_at,
      'occupied'::text as status,
      null::timestamptz as booking_opens_at,
      case
        when occupation.occupation_type = 'reservation'::public.occupation_type then
          coalesce(
            nullif(btrim(concat_ws(' ', club_member.first_name, club_member.last_name)), ''),
            nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
            nullif(btrim(profile.display_name), ''),
            nullif(btrim(reservation.guest_name), ''),
            'Réservation'
          )
        else coalesce(nullif(btrim(occupation.title), ''), 'Indisponibilité exceptionnelle')
      end as booked_by_name
    from public.calendar_occupations as occupation
    join public.reservable_resources as resource
      on resource.id = occupation.resource_id
     and resource.is_active
    left join public.reservations as reservation on reservation.id = occupation.reservation_id
    left join public.profiles as profile on profile.id = reservation.user_id
    left join public.club_members as club_member on club_member.id = public.profile_club_member_id(profile.id, resource.club_id)
    where occupation.resource_id = target_resource_id
      and occupation.cancelled_at is null
      and (occupation.starts_at at time zone resource.timezone)::date <= range_end
      and (occupation.ends_at at time zone resource.timezone)::date >= range_start
      and not exists (
        select 1
        from generated_slots as slot
        where slot.resource_id = occupation.resource_id
          and slot.starts_at = occupation.starts_at
          and slot.ends_at = occupation.ends_at
      )
  )
  select * from scheduled_slots
  union all
  select * from occupations_outside_schedule
  order by starts_at;
$function$

CREATE OR REPLACE FUNCTION public.assert_reservation_slot_allowed(target_resource_id uuid, target_user_id uuid, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone, excluded_reservation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(customer_type reservation_customer_type, price_cents integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  resource_active boolean;
  resource_timezone text;
  target_club_id uuid;
  settings public.club_reservation_settings%rowtype;
  terms record;
  championship_access record;
  active_count integer;
  booking_opens_at timestamptz;
  local_start timestamp;
  local_end timestamp;
  regular_opening_allowed boolean;
  released_permanent_at timestamptz;
  effective_advance_hours integer;
  effective_max_active integer;
begin
  if target_ends_at <= target_starts_at then
    raise exception 'La fin du créneau doit être postérieure au début'
      using errcode = '22007';
  end if;

  select club_id, is_active, timezone
  into target_club_id, resource_active, resource_timezone
  from public.reservable_resources
  where id = target_resource_id;

  if resource_active is distinct from true then
    raise exception 'La ressource demandée est indisponible'
      using errcode = 'P0001';
  end if;

  select *
  into strict settings
  from public.club_reservation_settings
  where club_id = target_club_id;

  if extract(epoch from (target_ends_at - target_starts_at))::integer / 60
    <> settings.default_duration_minutes then
    raise exception 'La durée du créneau ne respecte pas la durée configurée'
      using errcode = 'P0001';
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
  join public.permanent_slots as slot
    on slot.id = occurrence.permanent_slot_id
   and slot.is_active
  join public.calendar_occupations as private_occupation
    on private_occupation.id = occurrence.occupation_id
  where slot.resource_id = target_resource_id
    and occurrence.status = 'released'::public.permanent_slot_occurrence_status
    and private_occupation.starts_at = target_starts_at
    and private_occupation.ends_at = target_ends_at
  order by occurrence.released_at desc
  limit 1;

  select *
  into strict championship_access
  from public.get_championship_reservation_access(
    target_resource_id,
    target_user_id,
    target_starts_at,
    target_ends_at
  );

  if local_start::date <> local_end::date
    or (
      not regular_opening_allowed
      and not championship_access.is_priority
      and released_permanent_at is null
      and now() < coalesce(public.weekend_championship_release_at(target_resource_id,target_starts_at,target_ends_at),'infinity'::timestamptz)
    ) then
    raise exception 'Ce créneau se situe hors des horaires de réservation'
      using errcode = 'P0001';
  end if;

  select *
  into strict terms
  from public.get_reservation_terms_for_resource(
    target_resource_id,
    target_user_id,
    target_starts_at
  );

  effective_advance_hours := coalesce(
    championship_access.advance_hours,
    terms.advance_hours
  );
  effective_max_active := coalesce(
    championship_access.max_active_reservations,
    terms.max_active_reservations
  );

  booking_opens_at := public.get_reservation_booking_opens_at(
    target_starts_at,
    effective_advance_hours
  );

  if released_permanent_at is not null then
    booking_opens_at := least(booking_opens_at, released_permanent_at);
  end if;
  if not championship_access.is_priority then
    booking_opens_at := coalesce(public.weekend_championship_release_at(target_resource_id,target_starts_at,target_ends_at),booking_opens_at);
  end if;

  if now() < booking_opens_at then
    raise exception 'Ce créneau sera réservable à partir du %',
      to_char(
        booking_opens_at at time zone resource_timezone,
        'DD/MM/YYYY à HH24:MI'
      )
      using errcode = 'P0001';
  end if;

  if now() + make_interval(mins => settings.minimum_notice_minutes)
    >= target_starts_at then
    raise exception 'Le délai minimum avant réservation n''est pas respecté'
      using errcode = 'P0001';
  end if;

  if target_user_id is not null then
    select count(*)
    into active_count
    from public.reservations as active_reservation
    join public.reservable_resources as active_resource
      on active_resource.id = active_reservation.resource_id
    where active_reservation.user_id = target_user_id
      and active_reservation.id is distinct from excluded_reservation_id
      and active_reservation.status in ('pending', 'confirmed')
      and active_reservation.ends_at > now()
      and active_resource.club_id = target_club_id;

    if active_count >= effective_max_active then
      raise exception 'Le nombre maximal de réservations actives est atteint'
        using errcode = 'P0001';
    end if;
  end if;

  if exists (
    select 1
    from public.calendar_occupations
    where resource_id = target_resource_id
      and cancelled_at is null
      and (
        excluded_reservation_id is null
        or reservation_id is distinct from excluded_reservation_id
      )
      and tstzrange(starts_at, ends_at, '[)')
        && tstzrange(target_starts_at, target_ends_at, '[)')
  ) then
    raise exception 'Ce créneau est déjà occupé'
      using errcode = '23P01';
  end if;

  return query select terms.customer_type, terms.price_cents;
end;
$function$

commit;
