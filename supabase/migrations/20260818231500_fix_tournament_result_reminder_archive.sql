begin;

-- Un résultat saisi doit rendre inactif le rappel « Score à saisir ».
-- club_communications impose qu'une communication archivée ait archived_at renseigné.
create or replace function public.archive_tournament_result_entry_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.club_communications as communication
  set
    status = 'archived',
    archived_at = now(),
    updated_at = now()
  where communication.id in (
    select event.communication_id
    from public.tournament_match_reminder_events as event
    where event.match_id = new.match_id
      and event.reminder_kind = 'result_entry_due'
  )
    and communication.status = 'published';

  return new;
end;
$$;

revoke all on function public.archive_tournament_result_entry_reminders()
from public, anon, authenticated;

commit;
