begin;

-- PR125 — rendre les conflits de publication actionnables.
-- Lorsqu'une occupation bloquante provient d'un autre tournoi publié par
-- Pelote Manager, le preview expose uniquement l'identifiant, le nom et le
-- statut de ce tournoi. Les autres occupations restent non actionnables.

create or replace function public.admin_get_tournament_publication_preview(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status not in ('planning_generated', 'planning_published') then
    raise exception 'Tournament publication is not available at this stage'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', target_tournament.id,
      'name', target_tournament.name,
      'status', target_tournament.status,
      'starts_on', target_tournament.starts_on,
      'ends_on', target_tournament.ends_on
    ),
    'match_count', (
      select count(*)
      from public.tournament_matches as match
      where match.tournament_id = target_tournament.id
    ),
    'planned_match_count', (
      select count(*)
      from public.tournament_match_planning as planning
      where planning.tournament_id = target_tournament.id
    ),
    'published_match_count', (
      select count(*)
      from public.tournament_matches as match
      join public.tournament_match_events as link on link.match_id = match.id
      join public.events as event on event.id = link.event_id
      where match.tournament_id = target_tournament.id
        and event.publication_status = 'published'
    ),
    'conflicts', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'match_id', planning.match_id,
            'resource_id', planning.resource_id,
            'resource_name', resource.name,
            'play_date', planning.play_date,
            'starts_at', planning.starts_at,
            'ends_at', planning.ends_at,
            'match_label', concat(
              series.name,
              ' · ',
              public.tournament_team_public_label(match.team_a_id),
              ' — ',
              public.tournament_team_public_label(match.team_b_id)
            ),
            'occupation_id', occupation.id,
            'occupation_type', occupation.occupation_type,
            'occupation_title', occupation.title,
            'occupation_starts_at', occupation.starts_at,
            'occupation_ends_at', occupation.ends_at,
            'conflict_tournament_id', conflict_source.id,
            'conflict_tournament_name', conflict_source.name,
            'conflict_tournament_status', conflict_source.status
          )
          order by planning.play_date, planning.starts_at, resource.name
        ),
        '[]'::jsonb
      )
      from public.tournament_match_planning as planning
      join public.tournament_matches as match on match.id = planning.match_id
      join public.tournament_series as series on series.id = match.series_id
      join public.reservable_resources as resource on resource.id = planning.resource_id
      join public.calendar_occupations as occupation
        on occupation.resource_id = planning.resource_id
       and occupation.cancelled_at is null
       and occupation.starts_at < public.tournament_planning_starts_at(
         planning.play_date,
         planning.ends_at,
         resource.timezone
       )
       and occupation.ends_at > public.tournament_planning_starts_at(
         planning.play_date,
         planning.starts_at,
         resource.timezone
       )
      left join lateral (
        select
          conflicting_tournament.id,
          conflicting_tournament.name,
          conflicting_tournament.status
        from public.event_resources as event_resource
        join public.tournament_match_events as managed_event
          on managed_event.event_id = event_resource.event_id
        join public.tournament_matches as conflicting_match
          on conflicting_match.id = managed_event.match_id
        join public.tournaments as conflicting_tournament
          on conflicting_tournament.id = conflicting_match.tournament_id
        where event_resource.calendar_occupation_id = occupation.id
          and conflicting_tournament.club_id = target_club_id
          and conflicting_tournament.id <> target_tournament.id
        order by conflicting_tournament.id
        limit 1
      ) as conflict_source on true
      where planning.tournament_id = target_tournament.id
        and occupation.id not in (
          select event_resource.calendar_occupation_id
          from public.tournament_match_events as own_link
          join public.event_resources as event_resource
            on event_resource.event_id = own_link.event_id
          where own_link.match_id = planning.match_id
            and event_resource.calendar_occupation_id is not null
        )
    )
  );
end;
$$;

revoke all on function public.admin_get_tournament_publication_preview(uuid)
from public, anon, authenticated;
grant execute on function public.admin_get_tournament_publication_preview(uuid)
to authenticated;

commit;
