begin;

-- Une nouvelle programmation permet de nouveaux rappels pour la même rencontre.
-- Les communications passées restent archivées (historique des joueurs).
create or replace function public.reset_tournament_reminders_on_schedule_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_communication_ids uuid[];
begin
  if tg_op = 'UPDATE'
    and old.play_date is not distinct from new.play_date
    and old.starts_at is not distinct from new.starts_at
    and old.ends_at is not distinct from new.ends_at
    and old.resource_id is not distinct from new.resource_id
  then
    return new;
  end if;

  select array_agg(communication_id) into old_communication_ids
  from public.tournament_match_reminder_events
  where match_id = old.match_id
    and reminder_kind in ('match_day_10h','result_entry_due');

  if old_communication_ids is not null then
    update public.club_communications
    set status='archived', archived_at=now(), updated_at=now()
    where id=any(old_communication_ids) and status='published';

    delete from public.tournament_match_reminder_events
    where match_id=old.match_id
      and reminder_kind in ('match_day_10h','result_entry_due');
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function public.reset_tournament_reminders_on_schedule_change() from public,anon,authenticated;

create trigger reset_tournament_reminders_after_schedule_change
after update or delete on public.tournament_match_planning
for each row execute function public.reset_tournament_reminders_on_schedule_change();

commit;
