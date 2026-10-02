begin;

do $patch$
declare
  source_definition text;
  patched_definition text;
begin
  source_definition := pg_get_functiondef(
    'public.claim_external_participation(uuid)'::regprocedure
  );

  if position('min(tournament.club_id)' in source_definition) > 0 then
    patched_definition := replace(
      source_definition,
      'select min(tournament.club_id)',
      'select (array_agg(distinct tournament.club_id))[1]'
    );

    if patched_definition = source_definition then
      raise exception 'Could not patch claim_external_participation club aggregation';
    end if;

    execute patched_definition;
  end if;
end;
$patch$;

commit;
