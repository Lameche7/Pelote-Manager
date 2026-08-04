-- Les occupations existantes restent visibles même après une réduction des
-- horaires hebdomadaires. Les nouveaux créneaux libres restent, eux, générés
-- uniquement depuis resource_opening_hours.
create or replace function public.list_available_slots(
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
            nullif(
              btrim(concat_ws(' ', club_member.first_name, club_member.last_name)),
              ''
            ),
            nullif(
              btrim(concat_ws(' ', profile.first_name, profile.last_name)),
              ''
            ),
            nullif(btrim(profile.display_name), ''),
            nullif(btrim(reservation.guest_name), ''),
            'Réservation'
          )
        when occupation.id is not null then
          coalesce(
            nullif(btrim(occupation.title), ''),
            'Indisponibilité exceptionnelle'
          )
        else null
      end as booked_by_name
    from slots_with_terms as slot
    left join public.calendar_occupations as occupation
      on occupation.resource_id = slot.resource_id
      and occupation.cancelled_at is null
      and occupation.starts_at = slot.starts_at
      and occupation.ends_at = slot.ends_at
    left join public.reservations as reservation
      on reservation.id = occupation.reservation_id
    left join public.profiles as profile
      on profile.id = reservation.user_id
    left join public.club_members as club_member
      on club_member.id = profile.member_id
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
            nullif(
              btrim(concat_ws(' ', club_member.first_name, club_member.last_name)),
              ''
            ),
            nullif(
              btrim(concat_ws(' ', profile.first_name, profile.last_name)),
              ''
            ),
            nullif(btrim(profile.display_name), ''),
            nullif(btrim(reservation.guest_name), ''),
            'Réservation'
          )
        else coalesce(
          nullif(btrim(occupation.title), ''),
          'Indisponibilité exceptionnelle'
        )
      end as booked_by_name
    from public.calendar_occupations as occupation
    join public.reservable_resources as resource
      on resource.id = occupation.resource_id
      and resource.is_active
    left join public.reservations as reservation
      on reservation.id = occupation.reservation_id
    left join public.profiles as profile
      on profile.id = reservation.user_id
    left join public.club_members as club_member
      on club_member.id = profile.member_id
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
$$;

revoke all on function public.list_available_slots(uuid, date, date) from public;
grant execute on function public.list_available_slots(uuid, date, date)
to anon, authenticated;

-- Les commandes d'administration ne sont jamais exposées au rôle anonyme.
revoke all on function public.assert_reservations_manage_resource(uuid)
from public, anon, authenticated;
revoke all on function public.admin_list_opening_hours(uuid)
from public, anon, authenticated;
revoke all on function public.admin_save_opening_hour(bigint, uuid, smallint, time, time, boolean)
from public, anon, authenticated;
revoke all on function public.admin_delete_opening_hour(bigint)
from public, anon, authenticated;
revoke all on function public.admin_list_calendar_closures(uuid)
from public, anon, authenticated;
revoke all on function public.admin_create_calendar_closure(uuid, text, timestamptz, timestamptz)
from public, anon, authenticated;
revoke all on function public.admin_update_calendar_closure(uuid, text, timestamptz, timestamptz)
from public, anon, authenticated;
revoke all on function public.admin_delete_calendar_closure(uuid)
from public, anon, authenticated;
revoke all on function public.assert_reservation_slot_allowed(uuid, uuid, timestamptz, timestamptz, uuid)
from public, anon, authenticated;

grant execute on function public.admin_list_opening_hours(uuid) to authenticated;
grant execute on function public.admin_save_opening_hour(bigint, uuid, smallint, time, time, boolean) to authenticated;
grant execute on function public.admin_delete_opening_hour(bigint) to authenticated;
grant execute on function public.admin_list_calendar_closures(uuid) to authenticated;
grant execute on function public.admin_create_calendar_closure(uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_update_calendar_closure(uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_delete_calendar_closure(uuid) to authenticated;
grant execute on function public.assert_reservation_slot_allowed(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;
