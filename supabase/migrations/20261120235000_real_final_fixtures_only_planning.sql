-- Future knockout placeholders are bracket positions, never court bookings.
-- Keep already-created fixtures and expressly positioned finals untouched.
begin;

-- Cleanup only unresolved non-final nodes: no validated result, actual match,
-- published match or final-day position can satisfy this predicate.
update public.tournament_final_planning_nodes node
set resource_id=null, play_date=null, starts_at=null, ends_at=null,
    source=null, updated_at=now()
where node.resource_id is not null
  and node.round <> 'final'
  and not exists (
    select 1 from public.tournament_matches match
    where match.tournament_id=node.tournament_id
      and match.series_id=node.series_id
      and match.phase='finals'
      and match.final_round_number=node.round_number
      and match.display_order=node.display_order
      and match.team_a_id is not null
      and match.team_b_id is not null
  );

-- Protect every entry point (bulk editor, exceptional date editor, direct SQL
-- and future features) rather than relying only on the React interface.
create or replace function public.guard_unresolved_tournament_final_slot()
returns trigger language plpgsql set search_path=''
as $function$
begin
  if new.resource_id is null or new.round='final' then
    return new;
  end if;
  if exists (
    select 1 from public.tournament_matches match
    where match.tournament_id=new.tournament_id
      and match.series_id=new.series_id
      and match.phase='finals'
      and match.final_round_number=new.round_number
      and match.display_order=new.display_order
      and match.team_a_id is not null
      and match.team_b_id is not null
  ) then
    return new;
  end if;
  raise exception
    'Un créneau ne peut être attribué qu’à une rencontre dont les deux équipes sont connues'
    using errcode='23514';
end;
$function$;
revoke all on function public.guard_unresolved_tournament_final_slot()
from public,anon,authenticated;

drop trigger if exists guard_unresolved_tournament_final_slot
on public.tournament_final_planning_nodes;
create trigger guard_unresolved_tournament_final_slot
before insert or update of resource_id,play_date,starts_at,ends_at
on public.tournament_final_planning_nodes
for each row execute function public.guard_unresolved_tournament_final_slot();

commit;
