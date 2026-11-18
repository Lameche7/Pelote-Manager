-- Public display-only decoration: expose the round of a genuinely published
-- tournament final match for cards on the reservation calendar.
-- Provisional bracket positions and unpublished matches are never returned.
begin;

create or replace function public.list_published_tournament_final_calendar_rounds(
  target_resource_id uuid,
  range_start date,
  range_end date
)
returns table(
  starts_at timestamptz,
  ends_at timestamptz,
  final_round text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    occupation.starts_at,
    occupation.ends_at,
    match.final_round
  from public.calendar_occupations occupation
  join public.event_resources event_resource
    on event_resource.calendar_occupation_id = occupation.id
    and event_resource.resource_id = occupation.resource_id
  join public.events event
    on event.id = event_resource.event_id
    and event.publication_status = 'published'
    and event.visibility = 'public'
  join public.tournament_match_events match_event
    on match_event.event_id = event.id
  join public.tournament_matches match
    on match.id = match_event.match_id
    and match.phase = 'finals'
    and match.final_round is not null
  join public.reservable_resources resource
    on resource.id = occupation.resource_id
  where occupation.resource_id = target_resource_id
    and occupation.cancelled_at is null
    and occupation.starts_at < ((range_end + 1)::timestamp at time zone resource.timezone)
    and occupation.ends_at > (range_start::timestamp at time zone resource.timezone)
  order by occupation.starts_at, match.id;
$function$;

revoke all on function public.list_published_tournament_final_calendar_rounds(uuid,date,date)
from public, anon, authenticated;
grant execute on function public.list_published_tournament_final_calendar_rounds(uuid,date,date)
to anon, authenticated;

commit;
