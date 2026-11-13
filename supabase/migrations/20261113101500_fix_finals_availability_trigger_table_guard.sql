begin;

-- PL/pgSQL evaluates the NEW record for the triggered relation. Accessing
-- NEW.status in a compound condition fails for tournament_play_windows,
-- where that column does not exist. Check the relation first.
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
    if tg_op = 'UPDATE' then
      if new.status in (
        'pools_generated', 'pools_validated', 'planning_generated',
        'planning_published', 'in_progress'
      )
        and (
          new.finals_starts_on is distinct from old.finals_starts_on
          or new.finals_ends_on is distinct from old.finals_ends_on
        )
        and new.minimum_finals_availability_slots
          is not distinct from old.minimum_finals_availability_slots
      then
        return new;
      end if;
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

commit;
