begin;

-- PR125 — priorité de publication des tournois.
-- Une publication prioritaire libère les occupations concurrentes dans la même
-- transaction, puis délègue la création des événements au moteur de publication
-- existant. En cas d'échec final, toutes les évictions sont rollbackées.

create or replace function public.admin_publish_tournament_planning_priority(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  actor_id uuid := auth.uid();
  conflicting_tournament_id uuid;
  conflicting_event_id uuid;
  occupation_item record;
  previous_reservation public.reservations;
  cancelled_reservation public.reservations;
  previous_occupation public.calendar_occupations;
  cancelled_occupation public.calendar_occupations;
  previous_event public.events;
  archived_event public.events;
  published_count integer := 0;
  cancelled_reservation_count integer := 0;
  displaced_tournament_count integer := 0;
  archived_event_count integer := 0;
  cancelled_block_count integer := 0;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status <> 'planning_generated' then
    raise exception 'Tournament planning must be generated before publication'
      using errcode = 'P0001';
  end if;

  -- Verrouille les terrains ciblés avant toute éviction pour sérialiser la
  -- publication avec les réservations et les autres moteurs calendrier.
  perform 1
  from public.reservable_resources as resource
  where resource.id in (
    select distinct planning.resource_id
    from public.tournament_match_planning as planning
    where planning.tournament_id = target_tournament.id
  )
  order by resource.id
  for update;

  -- 1) Un autre tournoi publié cède la place au tournoi prioritaire.
  for conflicting_tournament_id in
    select distinct conflicting_match.tournament_id
    from public.calendar_occupations as occupation
    join public.event_resources as event_resource
      on event_resource.calendar_occupation_id = occupation.id
    join public.tournament_match_events as managed_event
      on managed_event.event_id = event_resource.event_id
    join public.tournament_matches as conflicting_match
      on conflicting_match.id = managed_event.match_id
    join public.tournaments as conflicting_tournament
      on conflicting_tournament.id = conflicting_match.tournament_id
    where occupation.cancelled_at is null
      and conflicting_tournament.club_id = target_club_id
      and conflicting_tournament.id <> target_tournament.id
      and conflicting_tournament.status = 'planning_published'
      and exists (
        select 1
        from public.tournament_match_planning as planning
        join public.reservable_resources as resource
          on resource.id = planning.resource_id
        where planning.tournament_id = target_tournament.id
          and planning.resource_id = occupation.resource_id
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
      )
    order by conflicting_match.tournament_id
  loop
    perform public.admin_unpublish_tournament_planning(conflicting_tournament_id);
    displaced_tournament_count := displaced_tournament_count + 1;
  end loop;

  -- 2) Les réservations actives sont annulées proprement. On ne publie pas de
  -- notification de créneau libéré : le tournoi occupe immédiatement le créneau.
  for occupation_item in
    select occupation.id, occupation.reservation_id
    from public.calendar_occupations as occupation
    where occupation.cancelled_at is null
      and occupation.occupation_type = 'reservation'
      and occupation.reservation_id is not null
      and exists (
        select 1
        from public.tournament_match_planning as planning
        join public.reservable_resources as resource
          on resource.id = planning.resource_id
        where planning.tournament_id = target_tournament.id
          and planning.resource_id = occupation.resource_id
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
      )
    order by occupation.id
  loop
    select reservation.*
    into previous_reservation
    from public.reservations as reservation
    where reservation.id = occupation_item.reservation_id
    for update;

    if previous_reservation.id is not null
      and previous_reservation.status in ('pending', 'confirmed') then
      update public.reservations
      set status = 'cancelled',
          cancelled_at = now(),
          cancelled_by = actor_id,
          cancellation_reason = concat(
            'Priorité tournoi : ',
            target_tournament.name
          ),
          updated_at = now(),
          updated_by = actor_id
      where id = previous_reservation.id
      returning * into cancelled_reservation;

      insert into public.reservation_audit_log (
        reservation_id,
        action,
        actor_id,
        previous_data,
        new_data
      )
      values (
        previous_reservation.id,
        'cancelled_by_tournament_priority',
        actor_id,
        to_jsonb(previous_reservation),
        to_jsonb(cancelled_reservation)
      );

      cancelled_reservation_count := cancelled_reservation_count + 1;
    end if;

    select occupation.*
    into previous_occupation
    from public.calendar_occupations as occupation
    where occupation.id = occupation_item.id
      and occupation.cancelled_at is null
    for update;

    if previous_occupation.id is not null then
      update public.calendar_occupations
      set cancelled_at = now(),
          updated_at = now(),
          updated_by = actor_id
      where id = previous_occupation.id
      returning * into cancelled_occupation;

      insert into public.calendar_occupation_audit_log (
        occupation_id,
        action,
        actor_id,
        previous_data,
        new_data
      )
      values (
        previous_occupation.id,
        'superseded_by_tournament',
        actor_id,
        to_jsonb(previous_occupation),
        to_jsonb(cancelled_occupation)
      );
    end if;
  end loop;

  -- 3) Un événement générique bloquant est archivé. Les événements pilotés par
  -- les tournois ont déjà été traités ci-dessus et sont explicitement exclus.
  for conflicting_event_id in
    select distinct event_resource.event_id
    from public.calendar_occupations as occupation
    join public.event_resources as event_resource
      on event_resource.calendar_occupation_id = occupation.id
    join public.events as event
      on event.id = event_resource.event_id
    left join public.tournament_match_events as managed_event
      on managed_event.event_id = event_resource.event_id
    where occupation.cancelled_at is null
      and event.club_id = target_club_id
      and managed_event.event_id is null
      and exists (
        select 1
        from public.tournament_match_planning as planning
        join public.reservable_resources as resource
          on resource.id = planning.resource_id
        where planning.tournament_id = target_tournament.id
          and planning.resource_id = occupation.resource_id
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
      )
    order by event_resource.event_id
  loop
    select event.*
    into previous_event
    from public.events as event
    where event.id = conflicting_event_id
      and event.club_id = target_club_id
    for update;

    if previous_event.id is not null
      and previous_event.publication_status <> 'archived' then
      update public.events
      set publication_status = 'archived',
          archived_at = coalesce(archived_at, now()),
          updated_at = now(),
          updated_by = actor_id
      where id = previous_event.id
      returning * into archived_event;

      perform public.sync_event_occupations(previous_event.id);

      insert into public.event_audit_log (
        club_id,
        event_id,
        action,
        actor_id,
        previous_data,
        new_data
      )
      values (
        target_club_id,
        previous_event.id,
        'archived',
        actor_id,
        to_jsonb(previous_event),
        to_jsonb(archived_event)
      );

      archived_event_count := archived_event_count + 1;
    end if;
  end loop;

  -- 4) Les blocages manuels restants (fermeture, maintenance, animation, etc.)
  -- sont supplantés avec une trace dédiée dans l'audit calendrier.
  for occupation_item in
    select occupation.id
    from public.calendar_occupations as occupation
    where occupation.cancelled_at is null
      and exists (
        select 1
        from public.tournament_match_planning as planning
        join public.reservable_resources as resource
          on resource.id = planning.resource_id
        where planning.tournament_id = target_tournament.id
          and planning.resource_id = occupation.resource_id
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
      )
      and occupation.id not in (
        select event_resource.calendar_occupation_id
        from public.tournament_match_events as own_link
        join public.event_resources as event_resource
          on event_resource.event_id = own_link.event_id
        where own_link.match_id in (
          select match.id
          from public.tournament_matches as match
          where match.tournament_id = target_tournament.id
        )
          and event_resource.calendar_occupation_id is not null
      )
    order by occupation.id
  loop
    select occupation.*
    into previous_occupation
    from public.calendar_occupations as occupation
    where occupation.id = occupation_item.id
      and occupation.cancelled_at is null
    for update;

    if previous_occupation.id is not null then
      update public.calendar_occupations
      set cancelled_at = now(),
          updated_at = now(),
          updated_by = actor_id
      where id = previous_occupation.id
      returning * into cancelled_occupation;

      insert into public.calendar_occupation_audit_log (
        occupation_id,
        action,
        actor_id,
        previous_data,
        new_data
      )
      values (
        previous_occupation.id,
        'superseded_by_tournament',
        actor_id,
        to_jsonb(previous_occupation),
        to_jsonb(cancelled_occupation)
      );

      cancelled_block_count := cancelled_block_count + 1;
    end if;
  end loop;

  -- Le moteur normal refait toutes ses validations et crée les événements. Si
  -- l'une d'elles échoue, PostgreSQL annule également toutes les évictions ci-dessus.
  published_count := public.admin_publish_tournament_planning(target_tournament.id);

  return jsonb_build_object(
    'published_count', published_count,
    'cancelled_reservation_count', cancelled_reservation_count,
    'displaced_tournament_count', displaced_tournament_count,
    'archived_event_count', archived_event_count,
    'cancelled_block_count', cancelled_block_count
  );
end;
$$;

revoke all on function public.admin_publish_tournament_planning_priority(uuid)
from public, anon, authenticated;
grant execute on function public.admin_publish_tournament_planning_priority(uuid)
to authenticated;

commit;
