-- The selected calendar's tournament defines the authorization scope.
-- Multi-club admins must not be rejected by admin_current_club_id().
-- has_club_permission checks auth.uid() membership and permission in the target club.
begin;
do $migration$
declare
  definition text;
  old_guard text;
  new_guard text;
  at_position integer;
begin
  definition := replace(
    pg_get_functiondef('public.admin_unprogram_tournament_match(uuid,text)'::regprocedure),
    chr(13), ''
  );
  old_guard := E'if t.club_id is distinct from public.admin_current_club_id()\n     or not public.has_club_permission(t.club_id,''tournaments.manage'') then';
  at_position := strpos(definition, old_guard);
  if at_position = 0 then
    raise exception 'Expected legacy single-club authorization guard not found';
  end if;
  new_guard := 'if not public.has_club_permission(t.club_id,''tournaments.manage'') then';
  definition := overlay(definition placing new_guard from at_position for length(old_guard));
  execute definition;
end;
$migration$;
commit;
