-- Championship fixtures are public information: keep them visible in the
-- reservation calendar even when the underlying admin reservation was created
-- before the normal booking window opens. The slot remains locked, so this
-- changes visibility only, never booking rights.
create or replace function public.list_available_slots_v4(
  target_resource_id uuid,
  range_start date,
  range_end date
)
returns table(
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
  coalesce(champ.display_name, slot.booked_by_name),
  case when champ.match_id is not null then 'championship_match' else slot.occupation_type end,
  coalesce(champ.display_color, slot.display_color),
  slot.reservation_access,
  coalesce(champ.result_display, slot.result_display)
from public.list_available_slots_v3(target_resource_id, range_start, range_end) slot
left join lateral (
  select
    m.id as match_id,
    concat_ws(E'\n', c.name, d.name, t1.source_label, concat('vs ', t2.source_label)) as display_name,
    coalesce(d.display_color, '#D5B04C') as display_color,
    case
      when m.status = 'played' and m.score_team1 is not null and m.score_team2 is not null
      then concat(t1.source_label, '  ', m.score_team1, ' – ', m.score_team2, '  ', t2.source_label)
      else null
    end as result_display
  from public.reservations r
  join public.championship_matches m on m.id = r.championship_match_id
  join public.championship_divisions d on d.id = m.division_id
  join public.championships c on c.id = d.championship_id
  join public.championship_teams t1 on t1.id = m.team1_id
  join public.championship_teams t2 on t2.id = m.team2_id
  where r.resource_id = slot.resource_id
    and r.status in ('pending', 'confirmed')
    and r.starts_at < slot.ends_at
    and r.ends_at > slot.starts_at
  order by r.created_at desc
  limit 1
) champ on true
order by slot.starts_at;
$$;

revoke all on function public.list_available_slots_v4(uuid,date,date) from public;
grant execute on function public.list_available_slots_v4(uuid,date,date) to anon, authenticated;