-- Final-stage dates can be chosen after pool planning without retroactively
-- invalidating the teams' availability submissions.
-- Keep normal minimum checks for team availability changes and for updates to
-- minimum_finals_availability_slots.
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
  else
    target_tournament_id := coalesce(new.tournament_id, old.tournament_id);
  end if;

  if tg_table_name = 'tournaments'
    and tg_op = 'UPDATE'
    and new.status in (
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
    -- The original selections were collected before the finals period
    -- was fixed. Keep them all; the planning engine filters by period.
    -- Do not re-run a retroactive minimum check on this dates-only edit.
    return new;
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

revoke all on function public.enforce_tournament_finals_availability_for_teams()
from public, anon, authenticated;
