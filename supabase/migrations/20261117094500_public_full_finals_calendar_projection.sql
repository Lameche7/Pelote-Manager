-- Public read-only presentation of all assigned finals nodes, including
-- later rounds whose participants are not known yet.
-- Never turn a provisional node into a real match or reservation.
begin;
create or replace function public.list_public_tournament_final_calendar_projections(
  target_resource_id uuid, range_start date, range_end date
)
returns table(starts_at timestamptz, ends_at timestamptz, display_name text)
language sql stable security definer set search_path = ''
as $function$
  select distinct
    (node.play_date + node.starts_at) at time zone coalesce(resource.timezone, 'Europe/Paris'),
    (node.play_date + node.ends_at) at time zone coalesce(resource.timezone, 'Europe/Paris'),
    concat(
      'Tournoi · ', series.name, ' · ',
      public.tournament_final_round_label(node.round),
      ' — adversaires à déterminer (prévisionnel)'
    )
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
    -- Real materialized fixtures already appear through occupations/calendar.
    and not exists (
      select 1
      from public.tournament_matches match
      join public.tournament_match_planning planning on planning.match_id = match.id
      where match.tournament_id = node.tournament_id
        and match.series_id = node.series_id
        and match.phase = 'finals'
        and match.final_round_number = node.round_number
        and match.display_order = node.display_order
    )
  order by 1;
$function$;
revoke all on function public.list_public_tournament_final_calendar_projections(uuid,date,date) from public;
grant execute on function public.list_public_tournament_final_calendar_projections(uuid,date,date) to anon, authenticated;
commit;