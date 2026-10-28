begin;

-- L'enregistrement de rappel est un verrou de déduplication pour une programmation.
-- Lorsqu'un match reçoit une nouvelle programmation, les rappels de l'ancienne
-- session doivent pouvoir être réémis, sans supprimer les communications déjà
-- publiées ni leur historique de réception / lecture.
create table public.tournament_match_reminder_history (
  communication_id uuid primary key references public.club_communications(id) on delete cascade,
  match_id uuid not null references public.tournament_matches(id) on delete cascade,
  team_id uuid not null references public.tournament_teams(id) on delete cascade,
  reminder_kind text not null,
  superseded_at timestamptz not null default now()
);
alter table public.tournament_match_reminder_history enable row level security;
revoke all on public.tournament_match_reminder_history from public, anon, authenticated;

create function public.reset_tournament_reminders_after_planning_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.play_date is not distinct from old.play_date
    and new.starts_at is not distinct from old.starts_at
    and new.ends_at is not distinct from old.ends_at
    and new.resource_id is not distinct from old.resource_id
  then
    return new;
  end if;

  -- On conserve l'historique complet des avis précédents et leurs destinataires.
  insert into public.tournament_match_reminder_history
    (communication_id, match_id, team_id, reminder_kind)
  select communication_id, match_id, team_id, reminder_kind
  from public.tournament_match_reminder_events
  where match_id = new.match_id
    and reminder_kind in ('match_day_10h', 'result_entry_due')
  on conflict (communication_id) do nothing;

  delete from public.tournament_match_reminder_events
  where match_id = new.match_id
    and reminder_kind in ('match_day_10h', 'result_entry_due');

  return new;
end;
$$;
revoke all on function public.reset_tournament_reminders_after_planning_change()
  from public, anon, authenticated;

create trigger reset_tournament_reminders_on_new_planning
after insert or update of play_date, starts_at, ends_at, resource_id
on public.tournament_match_planning
for each row
execute function public.reset_tournament_reminders_after_planning_change();

commit;
