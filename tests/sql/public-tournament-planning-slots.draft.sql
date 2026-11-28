-- Public planning exposes only published tournament matches on their own club's active resource.
create or replace function public.list_public_tournament_planning_slots(target_resource_id uuid, range_start date, range_end date)
returns table(resource_id uuid, starts_at timestamptz, ends_at timestamptz, status text, booking_opens_at timestamptz, booked_by_name text, occupation_type text, display_color text, reservation_access text, result_display text)
language sql stable security definer set search_path to ''
as $function$
select s.resource_id,s.starts_at,s.ends_at,s.status,s.booking_opens_at,s.booked_by_name,s.occupation_type,s.display_color,s.reservation_access,s.result_display
from public.list_available_slots_v4(target_resource_id,range_start,range_end) s
where s.resource_id=target_resource_id and s.status='occupied' and s.occupation_type='match'
and exists (
  select 1 from public.tournament_match_planning p
  join public.tournament_matches m on m.id=p.match_id and m.tournament_id=p.tournament_id
  join public.tournaments t on t.id=m.tournament_id
  join public.reservable_resources r on r.id=p.resource_id and r.club_id=t.club_id and r.is_active
  join public.tournament_match_events l on l.match_id=m.id
  join public.events e on e.id=l.event_id and e.club_id=t.club_id
  join public.event_resources er on er.event_id=e.id and er.resource_id=r.id
  where p.resource_id=s.resource_id and p.play_date between range_start and range_end
    and e.publication_status='published' and e.archived_at is null
    and e.starts_at=s.starts_at and e.ends_at=s.ends_at
    and public.tournament_planning_starts_at(p.play_date,p.starts_at,r.timezone)=s.starts_at
    and public.tournament_planning_starts_at(p.play_date,p.ends_at,r.timezone)=s.ends_at
);
$function$;
revoke all on function public.list_public_tournament_planning_slots(uuid,date,date) from public, anon, authenticated;
grant execute on function public.list_public_tournament_planning_slots(uuid,date,date) to anon,authenticated;
