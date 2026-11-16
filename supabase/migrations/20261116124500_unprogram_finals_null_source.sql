-- Unprogrammed finals nodes must have all scheduling fields NULL,
-- including source. Keeping source='manual' violates the existing CHECK.
begin;
do $migration$
declare
  definition text;
  old_statement text;
  new_statement text;
  at_position integer;
begin
  definition := replace(
    pg_get_functiondef('public.admin_unprogram_tournament_match(uuid,text)'::regprocedure),
    chr(13), ''
  );
  old_statement := E'set resource_id=null,play_date=null,starts_at=null,ends_at=null,\n        source=''manual'',updated_at=now()';
  at_position := strpos(definition, old_statement);
  if at_position = 0 then
    raise exception 'Expected finals unprogramming statement not found';
  end if;
  new_statement := E'set resource_id=null,play_date=null,starts_at=null,ends_at=null,\n        source=null,updated_at=now()';
  definition := overlay(definition placing new_statement from at_position for length(old_statement));
  execute definition;
end;
$migration$;
commit;
