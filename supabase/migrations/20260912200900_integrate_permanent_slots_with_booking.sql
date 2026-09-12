begin;

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
  resource_timezone text;
  settings public.reservation_settings%rowtype;
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

  select is_active, timezone
  into resource_active, resource_timezone
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
    ) then
    raise exception 'Ce créneau se situe hors des horaires de réservation'
      using errcode = 'P0001';
  end if;

  select *
  into strict terms
  from public.get_reservation_terms(target_user_id, target_starts_at);

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
    from public.reservations
    where user_id = target_user_id
      and id is distinct from excluded_reservation_id
      and status in ('pending', 'confirmed')
      and ends_at > now();

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
$$;

revoke all on function public.assert_reservation_slot_allowed(
  uuid, uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.assert_reservation_slot_allowed(
  uuid, uuid, timestamptz, timestamptz, uuid
) to authenticated;

drop function if exists public.list_available_slots_v2(uuid, date, date);

create function public.list_available_slots_v2(
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
  reservation_access text
)
language sql
stable
security definer
set search_path = ''
as $$
  with base_slots as (
    select
      slot.resource_id,
      slot.starts_at,
      slot.ends_at,
      slot.status,
      slot.booking_opens_at,
      slot.booked_by_name,
      false as is_permanent_release
    from public.list_available_slots(
      target_resource_id,
      range_start,
      range_end
    ) as slot
  ),
  released_occurrences as (
    select
      permanent_slot.resource_id,
      private_occupation.starts_at,
      private_occupation.ends_at,
      occurrence.released_at
    from public.permanent_slot_occurrences as occurrence
    join public.permanent_slots as permanent_slot
      on permanent_slot.id = occurrence.permanent_slot_id
     and permanent_slot.is_active
    join public.calendar_occupations as private_occupation
      on private_occupation.id = occurrence.occupation_id
    where permanent_slot.resource_id = target_resource_id
      and occurrence.status = 'released'::public.permanent_slot_occurrence_status
      and occurrence.occurrence_date between range_start and range_end
  ),
  released_slots_outside_schedule as (
    select
      released.resource_id,
      released.starts_at,
      released.ends_at,
      'available'::text as status,
      released.released_at as booking_opens_at,
      null::text as booked_by_name,
      true as is_permanent_release
    from released_occurrences as released
    where not exists (
      select 1
      from public.calendar_occupations as active_occupation
      where active_occupation.resource_id = released.resource_id
        and active_occupation.cancelled_at is null
        and tstzrange(active_occupation.starts_at, active_occupation.ends_at, '[)')
          && tstzrange(released.starts_at, released.ends_at, '[)')
    )
      and not exists (
        select 1
        from base_slots as base_slot
        where base_slot.resource_id = released.resource_id
          and base_slot.starts_at = released.starts_at
          and base_slot.ends_at = released.ends_at
      )
  ),
  all_slots as (
    select * from base_slots
    union all
    select * from released_slots_outside_schedule
  ),
  decorated_slots as (
    select
      slot.*,
      release.released_at,
      metadata.occupation_type,
      metadata.display_color,
      access.is_priority
    from all_slots as slot
    cross join lateral public.get_championship_reservation_access(
      slot.resource_id,
      auth.uid(),
      slot.starts_at,
      slot.ends_at
    ) as access
    left join released_occurrences as release
      on release.resource_id = slot.resource_id
     and release.starts_at = slot.starts_at
     and release.ends_at = slot.ends_at
    left join lateral (
      select
        occupation.occupation_type::text as occupation_type,
        series.color as display_color
      from public.calendar_occupations as occupation
      left join public.event_resources as event_resource
        on event_resource.calendar_occupation_id = occupation.id
      left join public.tournament_match_events as match_event
        on match_event.event_id = event_resource.event_id
      left join public.tournament_matches as match
        on match.id = match_event.match_id
      left join public.tournament_series as series
        on series.id = match.series_id
      where occupation.resource_id = slot.resource_id
        and occupation.cancelled_at is null
        and occupation.starts_at = slot.starts_at
        and occupation.ends_at = slot.ends_at
      order by
        case when series.color is not null then 0 else 1 end,
        occupation.id
      limit 1
    ) as metadata on true
  )
  select
    slot.resource_id,
    slot.starts_at,
    slot.ends_at,
    case
      when slot.released_at is not null and slot.status = 'locked' then 'available'
      else slot.status
    end as status,
    case
      when slot.released_at is not null then least(slot.booking_opens_at, slot.released_at)
      else slot.booking_opens_at
    end as booking_opens_at,
    slot.booked_by_name,
    coalesce(
      slot.occupation_type,
      case when slot.released_at is not null then 'permanent_release' end
    ) as occupation_type,
    slot.display_color,
    case when slot.is_priority then 'championship' else 'standard' end
      as reservation_access
  from decorated_slots as slot
  where coalesce(slot.occupation_type, '') <> 'private_use'
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots_v2(uuid, date, date)
from public;
grant execute on function public.list_available_slots_v2(uuid, date, date)
to anon, authenticated;

commit;
