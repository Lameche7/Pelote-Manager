create function public.reset_reservation_test_data()
returns table (
  deleted_reservations integer,
  deleted_occupations integer,
  deleted_payments integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_count integer;
  occupation_count integer;
  payment_count integer;
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  select count(*) into reservation_count from public.reservations;
  select count(*) into occupation_count
  from public.calendar_occupations
  where reservation_id is not null;
  select count(*) into payment_count from public.payments;

  delete from public.payment_events;
  delete from public.payments;
  delete from public.calendar_occupations where reservation_id is not null;
  delete from public.reservation_audit_log;
  delete from public.reservations;

  return query select reservation_count, occupation_count, payment_count;
end;
$$;

revoke all on function public.reset_reservation_test_data() from public;
grant execute on function public.reset_reservation_test_data() to authenticated;

drop function public.list_available_slots(uuid, date, date);

create function public.list_available_slots(
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
  booked_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  with resource_config as (
    select
      resource.id,
      resource.timezone,
      settings.default_duration_minutes,
      settings.booking_step_minutes
    from public.reservable_resources as resource
    cross join public.reservation_settings as settings
    where resource.id = target_resource_id
      and resource.is_active
  ),
  calendar_days as (
    select day_value::date as calendar_date
    from generate_series(range_start, range_end, interval '1 day') as day_value
  ),
  opening_periods as (
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
  generated_slots as (
    select
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
      public.get_reservation_booking_opens_at(
        slot.starts_at,
        terms.advance_hours
      ) as booking_opens_at
    from generated_slots as slot
    cross join lateral public.get_reservation_terms(auth.uid(), slot.starts_at) as terms
  )
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
        coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(reservation.guest_name), ''), 'Réservation')
      else nullif(btrim(occupation.title), '')
    end as booked_by_name
  from slots_with_terms as slot
  left join lateral (
    select current_occupation.*
    from public.calendar_occupations as current_occupation
    where current_occupation.resource_id = slot.resource_id
      and current_occupation.cancelled_at is null
      and current_occupation.starts_at < slot.ends_at
      and current_occupation.ends_at > slot.starts_at
    order by current_occupation.starts_at
    limit 1
  ) as occupation on true
  left join public.reservations as reservation
    on reservation.id = occupation.reservation_id
  left join public.profiles as profile
    on profile.id = reservation.user_id
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots(uuid, date, date) from public;
grant execute on function public.list_available_slots(uuid, date, date)
to anon, authenticated;
