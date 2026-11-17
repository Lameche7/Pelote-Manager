-- V2 includes bracket keys so the calendar can reuse the public results
-- projection from Mes tournois without guessing future winners.
-- Never turn a provisional node into a real match or reservation.
begin;
create or replace function public.list_public_tournament_final_calendar_projections_v2(
  target_resource_id uuid, range_start date, range_end date
)
returns table(starts_at timestamptz, ends_at timestamptz, display_name text,
              tournament_id uuid, series_id uuid, round_number integer,
              display_order integer)
language sql stable security definer set search_path = ''
as $function$
  select distinct
    (node.play_date + node.starts_at) at time zone coalesce(resource.timezone, 'Europe/Paris'),
    (node.play_date + node.ends_at) at time zone coalesce(resource.timezone, 'Europe/Paris'),
    concat(
      'Tournoi · ', series.name, ' · ',
      public.tournament_final_round_label(node.round),
      ' — adversaires à déterminer (prévisionnel)'
    ),
    node.tournament_id, node.series_id, node.round_number, node.display_order
  from public.reservable_resources resource
  join public.tournaments tournament on tournament.club_id = resource.club_id
  join public.tournament_final_planning_nodes node
    on node.tournament_id = tournament.id and node.resource_id = resource.id
  join public.tournament_series series
    on series.id = node.series_id and series.tournament_id = tournament.id
  where resource.id = target_resource_id
    and resource.is_active
    and tournament.status in ('planning_published', 'in_progress')
    and node.play_date between range_start and range_end
    and node.play_date between tournament.finals_starts_on and tournament.finals_ends_on
    and node.starts_at is not null and node.ends_at is not null
    and node.source is not null
    -- Only published fixtures with a real calendar occupation take priority.
    -- A future-round match may exist in planning without being published yet.
    and not exists (
      select 1
      from public.tournament_matches match
      join public.tournament_match_events link on link.match_id = match.id
      join public.events event on event.id = link.event_id
      join public.event_resources event_resource on event_resource.event_id = event.id
      join public.calendar_occupations occupation
        on occupation.id = event_resource.calendar_occupation_id
      where match.tournament_id = node.tournament_id
        and match.series_id = node.series_id
        and match.phase = 'finals'
        and match.final_round_number = node.round_number
        and match.display_order = node.display_order
        and event.publication_status = 'published'
        and occupation.cancelled_at is null
    )
  order by 1;
$function$;
revoke all on function public.list_public_tournament_final_calendar_projections_v2(uuid,date,date) from public;
grant execute on function public.list_public_tournament_final_calendar_projections_v2(uuid,date,date) to anon, authenticated;
commit;