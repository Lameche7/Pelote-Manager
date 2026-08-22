begin;

-- Correctif cumulatif du retrait d'un tour de phase finale :
-- 1. un événement archivé doit renseigner archived_at ;
-- 2. sync_event_occupations attend l'UUID de l'événement et non la ligne public.events.

create or replace function public.admin_unpublish_tournament_final_round(
  target_tournament_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  item record;
  unpublished_count integer := 0;
begin
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

  perform set_config('app.allow_tournament_event_sync', 'on', true);

  for item in
    select
      match.id as match_id,
      link.event_id
    from public.tournament_matches as match
    join public.tournament_match_events as link on link.match_id = match.id
    join public.events as event on event.id = link.event_id
    left join public.tournament_match_results as result on result.match_id = match.id
    where match.tournament_id = target_tournament.id
      and match.phase = 'finals'
      and result.id is null
      and event.publication_status = 'published'
    order by match.final_round_number, match.display_order
  loop
    update public.events as event
    set
      publication_status = 'archived',
      archived_at = coalesce(event.archived_at, now()),
      updated_at = now(),
      updated_by = auth.uid()
    where event.id = item.event_id;

    -- L'Event Engine reçoit toujours l'identifiant de l'événement.
    perform public.sync_event_occupations(item.event_id);

    update public.club_communications as communication
    set
      status = 'archived',
      archived_at = coalesce(communication.archived_at, now()),
      updated_at = now(),
      updated_by = auth.uid()
    where communication.id in (
      select reminder.communication_id
      from public.tournament_match_reminder_events as reminder
      where reminder.match_id = item.match_id
        and reminder.reminder_kind = 'final_round_published'
    )
      and communication.status = 'published';

    delete from public.tournament_match_reminder_events as reminder
    where reminder.match_id = item.match_id
      and reminder.reminder_kind = 'final_round_published';

    delete from public.tournament_match_events as link
    where link.match_id = item.match_id;

    unpublished_count := unpublished_count + 1;
  end loop;

  if unpublished_count = 0 then
    raise exception 'No published tournament finals matches are ready for replanning'
      using errcode = 'P0001';
  end if;

  return unpublished_count;
end;
$$;

revoke all on function public.admin_unpublish_tournament_final_round(uuid)
from public, anon, authenticated;
grant execute on function public.admin_unpublish_tournament_final_round(uuid)
to authenticated;

commit;
