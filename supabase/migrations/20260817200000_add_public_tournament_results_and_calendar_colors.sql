begin;

-- Vue publique sportive d'un tournoi : une navigation par série, les matchs de
-- chaque poule et uniquement les scores officiellement validés. Les résultats
-- transmis mais encore en attente restent signalés sans exposer leur score.
create or replace function public.get_public_tournament_results(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    return null;
  end if;

  if target_tournament.status not in (
    'planning_published',
    'in_progress',
    'completed',
    'archived'
  ) then
    return null;
  end if;

  return jsonb_build_object(
    'tournament_id', target_tournament.id,
    'tournament_name', target_tournament.name,
    'status', target_tournament.status,
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', series.id,
          'name', series.name,
          'color', series.color,
          'display_order', series.display_order,
          'pools', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', pool.id,
                'number', pool.display_order + 1,
                'matches', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', match.id,
                      'display_order', match.display_order,
                      'team_a_id', match.team_a_id,
                      'team_a_label', public.tournament_team_public_label(match.team_a_id),
                      'team_b_id', match.team_b_id,
                      'team_b_label', public.tournament_team_public_label(match.team_b_id),
                      'play_date', planning.play_date,
                      'starts_at', planning.starts_at,
                      'ends_at', planning.ends_at,
                      'scheduled_start_at', public.tournament_planning_starts_at(
                        planning.play_date,
                        planning.starts_at,
                        resource.timezone
                      ),
                      'scheduled_end_at', public.tournament_planning_starts_at(
                        planning.play_date,
                        planning.ends_at,
                        resource.timezone
                      ),
                      'resource_name', resource.name,
                      'result_status', result.status,
                      'score', case
                        when result.status = 'validated' then result.score
                        else null
                      end,
                      'team_a_sets', case
                        when result.status = 'validated' then result.team_a_sets
                        else null
                      end,
                      'team_b_sets', case
                        when result.status = 'validated' then result.team_b_sets
                        else null
                      end
                    )
                    order by planning.play_date, planning.starts_at, match.display_order
                  )
                  from public.tournament_matches as match
                  join public.tournament_match_planning as planning
                    on planning.match_id = match.id
                  join public.reservable_resources as resource
                    on resource.id = planning.resource_id
                  left join public.tournament_match_results as result
                    on result.match_id = match.id
                  where match.pool_id = pool.id
                ), '[]'::jsonb)
              )
              order by pool.display_order
            )
            from public.tournament_pools as pool
            where pool.tournament_id = target_tournament.id
              and pool.series_id = series.id
          ), '[]'::jsonb)
        )
        order by series.display_order, series.name
      )
      from public.tournament_series as series
      where series.tournament_id = target_tournament.id
        and series.enabled
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_tournament_results(uuid) from public;
grant execute on function public.get_public_tournament_results(uuid)
to anon, authenticated;

-- Version enrichie du calendrier public. La fonction historique reste intacte :
-- on lui ajoute seulement des métadonnées de présentation lorsque l'occupation
-- correspond à un match de tournoi publié.
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
  display_color text
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
    slot.booked_by_name,
    metadata.occupation_type,
    metadata.display_color
  from public.list_available_slots(
    target_resource_id,
    range_start,
    range_end
  ) as slot
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
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots_v2(uuid, date, date)
from public;
grant execute on function public.list_available_slots_v2(uuid, date, date)
to anon, authenticated;

commit;
