begin;

create or replace function public.list_available_slots_v3(
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
  select
    slot.resource_id,
    slot.starts_at,
    slot.ends_at,
    slot.status,
    slot.booking_opens_at,
    coalesce(championship_slot.display_name, slot.booked_by_name),
    case
      when championship_slot.match_id is not null then 'championship_match'
      else slot.occupation_type
    end,
    coalesce(championship_slot.display_color, slot.display_color),
    slot.reservation_access
  from public.list_available_slots_v2(
    target_resource_id,
    range_start,
    range_end
  ) as slot
  left join lateral (
    select
      match.id as match_id,
      concat_ws(E'\n',
        championship.name,
        division.name,
        team1.source_label,
        concat('vs ', team2.source_label)
      ) as display_name,
      coalesce(division.display_color, '#D5B04C') as display_color
    from public.reservations as reservation
    join public.championship_matches as match
      on match.id = reservation.championship_match_id
    join public.championship_divisions as division
      on division.id = match.division_id
    join public.championships as championship
      on championship.id = division.championship_id
    join public.championship_teams as team1 on team1.id = match.team1_id
    join public.championship_teams as team2 on team2.id = match.team2_id
    where reservation.resource_id = slot.resource_id
      and reservation.status in ('pending', 'confirmed')
      and reservation.starts_at < slot.ends_at
      and reservation.ends_at > slot.starts_at
    order by reservation.created_at desc
    limit 1
  ) as championship_slot on true
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots_v3(uuid, date, date)
from public, anon, authenticated;
grant execute on function public.list_available_slots_v3(uuid, date, date)
to anon, authenticated;

create or replace function public.get_public_tv_championship_slot_decorations(
  target_token uuid
)
returns table (
  resource_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  championship_name text,
  division_name text,
  match_label text,
  display_color text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    reservation.resource_id,
    reservation.starts_at,
    reservation.ends_at,
    championship.name,
    division.name,
    concat_ws(E'\n', team1.source_label, concat('vs ', team2.source_label)),
    coalesce(division.display_color, '#D5B04C')
  from public.club_tv_settings as settings
  join public.club_tv_resources as selected_resource
    on selected_resource.club_id = settings.club_id
  join public.reservations as reservation
    on reservation.resource_id = selected_resource.resource_id
   and reservation.status in ('pending', 'confirmed')
   and reservation.championship_match_id is not null
  join public.championship_matches as match
    on match.id = reservation.championship_match_id
  join public.championship_divisions as division
    on division.id = match.division_id
  join public.championships as championship
    on championship.id = division.championship_id
  join public.championship_teams as team1 on team1.id = match.team1_id
  join public.championship_teams as team2 on team2.id = match.team2_id
  where settings.public_token = target_token
    and settings.is_enabled
    and reservation.ends_at > (
      ((now() at time zone 'Europe/Paris')::date)::timestamp
      at time zone 'Europe/Paris'
    )
    and reservation.starts_at < (
      (((now() at time zone 'Europe/Paris')::date + 7)::timestamp)
      at time zone 'Europe/Paris'
    )
  order by reservation.starts_at, reservation.resource_id;
$$;

revoke all on function public.get_public_tv_championship_slot_decorations(uuid)
from public, anon, authenticated;
grant execute on function public.get_public_tv_championship_slot_decorations(uuid)
to anon, authenticated;

commit;
