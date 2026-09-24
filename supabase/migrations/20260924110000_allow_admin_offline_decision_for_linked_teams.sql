-- Allow tournament administrators to record a genuinely obtained offline
-- decision even when the team also has linked application accounts.
-- The existing RPC still requires tournament management permission, a pending
-- request/approval and a 3-500 character contact note, and keeps the audit trail.
do $$
declare
  source_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.admin_record_tournament_reschedule_offline_decision(uuid,uuid,text,text)'::regprocedure
  )
  into source_definition;

  patched_definition := replace(
    source_definition,
    E'  if public.tournament_team_app_actor_count(target_team_id) > 0 then\n    raise exception ''Tournament reschedule team can answer in the application''\n      using errcode = ''P0001'';\n  end if;\n\n',
    ''
  );

  if patched_definition = source_definition then
    raise exception 'Could not remove linked-account restriction from offline reschedule decisions';
  end if;

  execute patched_definition;
end;
$$;
