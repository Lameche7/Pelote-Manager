create function public.get_reservation_booking_opens_at(
  target_starts_at timestamptz,
  advance_hours integer
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (
    (
      (target_starts_at at time zone 'Europe/Paris')::date
      - ((greatest(advance_hours, 0) + 23) / 24)
    ) + time '08:00'
  ) at time zone 'Europe/Paris';
$$;

revoke all on function public.get_reservation_booking_opens_at(timestamptz, integer)
from public;
grant execute on function public.get_reservation_booking_opens_at(timestamptz, integer)
to anon, authenticated;

create or replace function public.assert_reservation_slot_allowed(
  target_resource_id uuid,
  target_user_id uuid,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  excluded_reservation_id uuid default null
)
returns table (
  customer_type public.reservation_customer_type,
  price_cents integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_active boolean;
  settings public.reservation_settings%rowtype;
  terms record;
  active_count integer;
  booking_opens_at timestamptz;
begin
  if target_ends_at <= target_starts_at then
    raise exception 'La fin du créneau doit être postérieure au début'
      using errcode = '22007';
  end if;

  select is_active
  into resource_active
  from public.reservable_resources
  where id = target_resource_id;

  if resource_active is distinct from true then
    raise exception 'La ressource demandée est indisponible'
      using errcode = 'P0001';
  end if;

  select *
  into strict settings
  from public.reservation_settings
  where id;

  if extract(epoch from (target_ends_at - target_starts_at))::integer / 60
    <> settings.default_duration_minutes then
    raise exception 'La durée du créneau ne respecte pas la durée configurée'
      using errcode = 'P0001';
  end if;

  select *
  into strict terms
  from public.get_reservation_terms(target_user_id, target_starts_at);

  booking_opens_at := public.get_reservation_booking_opens_at(
    target_starts_at,
    terms.advance_hours
  );

  if now() < booking_opens_at then
    raise exception 'Ce créneau sera réservable à partir du %',
      to_char(booking_opens_at at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI')
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
    from public.reservations
    where user_id = target_user_id
      and id is distinct from excluded_reservation_id
      and status in ('pending', 'confirmed')
      and ends_at > now();

    if active_count >= terms.max_active_reservations then
      raise exception 'Le nombre maximal de réservations actives est atteint'
        using errcode = 'P0001';
    end if;
  end if;

  if exists (
    select 1
    from public.calendar_occupations
    where resource_id = target_resource_id
      and cancelled_at is null
      and reservation_id is distinct from excluded_reservation_id
      and tstzrange(starts_at, ends_at, '[)')
        && tstzrange(target_starts_at, target_ends_at, '[)')
  ) then
    raise exception 'Ce créneau est déjà occupé'
      using errcode = '23P01';
  end if;

  return query select terms.customer_type, terms.price_cents;
end;
$$;

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
  booking_opens_at timestamptz
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
      when exists (
        select 1
        from public.calendar_occupations as occupation
        where occupation.resource_id = slot.resource_id
          and occupation.cancelled_at is null
          and occupation.starts_at < slot.ends_at
          and occupation.ends_at > slot.starts_at
      ) then 'occupied'
      when now() < slot.booking_opens_at then 'locked'
      else 'available'
    end as status,
    slot.booking_opens_at
  from slots_with_terms as slot
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots(uuid, date, date) from public;
grant execute on function public.list_available_slots(uuid, date, date)
to anon, authenticated;
