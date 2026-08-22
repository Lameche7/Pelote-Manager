begin;

-- La communication impose archived_at non nul dès que son statut passe à archived.
-- Le trigger créé avec les rappels après-partie ne renseignait que le statut :
-- l'insertion du résultat était donc annulée par club_communications_check1.
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
