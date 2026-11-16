-- Finals: allow proposing a free slot outside the opponent's declared
-- availability. Approval is still mandatory; this does not move any match.
-- Preserve the existing pool-stage and swap restrictions.
begin;
do $migration$
declare
  definition text;
  needle text;
  replacement text;
  at_position integer;
begin
  definition := replace(
    pg_get_functiondef('public.get_my_tournament_reschedule_options_engine(uuid,uuid)'::regprocedure),
    chr(13), ''
  );
  needle := E'          and (\n            not measured.opponent_has_availability\n            or measured.opponent_declared_available\n          )';
  at_position := strpos(definition, needle);
  if at_position = 0 then
    raise exception 'Expected finals availability filter not found in reschedule engine';
  end if;
  replacement := E'          and (\n            target_match.phase = ''finals''\n            or not measured.opponent_has_availability\n            or measured.opponent_declared_available\n          )';
  definition := overlay(definition placing replacement from at_position for length(needle));

  needle := '''opponent_availability_known'', eligible.opponent_has_availability,';
  if strpos(definition, needle) = 0 then
    raise exception 'Expected free-slot availability field not found';
  end if;
  replacement := needle || E'\n            ''opponent_outside_declared_availability'',\n              eligible.opponent_has_availability and not eligible.opponent_declared_available,';
  definition := replace(definition, needle, replacement);
  execute definition;

  definition := pg_get_functiondef('public.admin_apply_tournament_reschedule_request(uuid)'::regprocedure);
  needle := 'if not manual_agreement_override and exists (';
  if strpos(definition, needle) = 0 then
    raise exception 'Expected apply-time availability guard not found';
  end if;
  replacement := E'if not (request.proposal_kind = ''free_slot'' and target_match.phase = ''finals'')\n    and not manual_agreement_override and exists (';
  at_position := strpos(definition, needle);
  definition := overlay(definition placing replacement from at_position for length(needle));
  execute definition;
end;
$migration$;
commit;
