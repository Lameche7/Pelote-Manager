begin;

-- PR235 — un échange doit libérer les deux occupations calendrier avant
-- de recréer l'un ou l'autre des deux créneaux.
--
-- Sans cela, le premier match déplacé vers le créneau du second rencontre
-- encore l'occupation calendrier du second match et déclenche à tort la
-- contrainte calendar_occupations_no_overlap.

do $$
declare
  source_definition text;
  patched_definition text;
  swap_sync_block text := E'      perform public.sync_tournament_reschedule_match_event(\n        request.match_id,\n        request.target_resource_id,\n        request.target_play_date,\n        request.target_starts_at,\n        request.target_ends_at\n      );\n\n      perform public.sync_tournament_reschedule_match_event(\n        request.swap_match_id,\n        request.swap_return_resource_id,\n        request.swap_return_play_date,\n        request.swap_return_starts_at,\n        request.swap_return_ends_at\n      );';
  atomic_swap_sync_block text := E'      -- Les deux occupations source appartiennent aux deux matchs de l''échange.\n      -- On les libère ensemble avant de recréer l''une ou l''autre, sinon le\n      -- premier déplacement entre en conflit avec le second créneau encore occupé.\n      delete from public.calendar_occupations as occupation\n      using public.event_resources as event_resource\n      where event_resource.event_id in (target_event_id, swap_event_id)\n        and event_resource.calendar_occupation_id = occupation.id;\n\n      perform public.sync_tournament_reschedule_match_event(\n        request.match_id,\n        request.target_resource_id,\n        request.target_play_date,\n        request.target_starts_at,\n        request.target_ends_at\n      );\n\n      perform public.sync_tournament_reschedule_match_event(\n        request.swap_match_id,\n        request.swap_return_resource_id,\n        request.swap_return_play_date,\n        request.swap_return_starts_at,\n        request.swap_return_ends_at\n      );';
begin
  source_definition := replace(
    pg_get_functiondef(
      'public.admin_apply_tournament_reschedule_request(uuid)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position(
    'event_resource.event_id in (target_event_id, swap_event_id)'
    in source_definition
  ) = 0 then
    patched_definition := replace(
      source_definition,
      swap_sync_block,
      atomic_swap_sync_block
    );

    if patched_definition = source_definition then
      raise exception 'Could not patch atomic tournament reschedule swap calendar sync';
    end if;

    execute patched_definition;
  end if;
end;
$$;

commit;
