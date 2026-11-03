-- Date-only finals edits must not retroactively enforce teams' original 35-slot
-- minimum. Keep the deferred guard for changes to slot generation rules.
create or replace function public.enforce_tournament_finals_availability_for_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament_id uuid;
  team_row record;
begin
  if tg_table_name = 'tournaments' then
    target_tournament_id := coalesce(new.id, old.id);

    if tg_op = 'UPDATE'
      and new.minimum_finals_availability_slots is not distinct from old.minimum_finals_availability_slots
      and new.pool_starts_on is not distinct from old.pool_starts_on
      and new.pool_ends_on is not distinct from old.pool_ends_on
      and new.slot_duration_minutes is not distinct from old.slot_duration_minutes then
      -- Finals date changes keep all submitted availability intact.
      -- Admin date RPC separately protects previously planned finals.
      return new;
    end if;
  else
    target_tournament_id := coalesce(new.tournament_id, old.tournament_id);
  end if;

  for team_row in
    select team.id
    from public.tournament_teams as team
    where team.tournament_id = target_tournament_id
      and team.status in ('pending', 'accepted')
  loop
    perform public.assert_tournament_team_finals_availability(team_row.id);
  end loop;

  return coalesce(new, old);
end;
$$;
