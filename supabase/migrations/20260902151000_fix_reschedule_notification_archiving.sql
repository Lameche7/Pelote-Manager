begin;

-- Hotfix: archived club communications must carry archived_at to satisfy
-- club_communications consistency checks. Without this, accepting/refusing a
-- reschedule request can roll back while archiving its notification.

create or replace function public.archive_tournament_reschedule_team_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.decision = 'pending' and new.decision <> 'pending' then
    update public.club_communications as communication
    set
      status = 'archived',
      archived_at = coalesce(communication.archived_at, now()),
      updated_at = now()
    where communication.id in (
      select event.communication_id
      from public.tournament_reschedule_notification_events as event
      where event.request_id = new.request_id
        and event.team_id = new.team_id
        and event.event_kind = 'approval_requested'
    )
      and communication.status = 'published';
  end if;
  return new;
end;
$$;

revoke all on function public.archive_tournament_reschedule_team_notification()
from public, anon, authenticated;

create or replace function public.archive_tournament_reschedule_request_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    update public.club_communications as communication
    set
      status = 'archived',
      archived_at = coalesce(communication.archived_at, now()),
      updated_at = now()
    where communication.id in (
      select event.communication_id
      from public.tournament_reschedule_notification_events as event
      where event.request_id = new.id
    )
      and communication.status = 'published';
  end if;
  return new;
end;
$$;

revoke all on function public.archive_tournament_reschedule_request_notifications()
from public, anon, authenticated;

commit;
