begin;

-- list_available_slots_v2 transportait déjà la bonne couleur de série, mais
-- conservait occupation_type = 'club_event' pour les événements issus d'un
-- match de tournoi. L'interface Réservations attend 'match' pour appliquer la
-- présentation spécifique par série.
create or replace function public.list_available_slots_v2(
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
        case
          when series.id is not null then 'match'
          else occupation.occupation_type::text
        end as occupation_type,
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
