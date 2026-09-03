begin;

-- Le classeur réel Errebot peut proposer des créneaux "Finales" avant la fin
-- globale des poules (certaines séries terminent plus tôt). Ces créneaux sont
-- une grille de disponibilités, pas les dates officielles des phases finales.
-- On les conserve donc sans imposer finals_starts_on > pool_ends_on.

do $$
declare
  function_def text;
begin
  function_def := pg_get_functiondef(
    'public.admin_preview_errebot_availability_import_compact(uuid,jsonb)'::regprocedure
  );
  function_def := regexp_replace(
    function_def,
    '(\) <= target_tournament\.pool_ends_on)(\s*)',
    '\1 and false\2',
    'g'
  );
  execute function_def;

  -- Corrige aussi le validateur ensembliste utilisé lors de l'import réel :
  -- 1) référence qualifiée pour éviter l'ambiguïté external_team_id ;
  -- 2) pas de rejet d'une grille "Finales" qui chevauche la fin globale des poules.
  function_def := pg_get_functiondef(
    'public.validate_errebot_availability_import_payload(uuid,jsonb)'::regprocedure
  );
  function_def := replace(
    function_def,
    '        external_team_id <> ''''\r\n        and phase in (''pools'', ''finals'')',
    '        declaration_input.external_team_id <> ''''\r\n        and declaration_input.phase in (''pools'', ''finals'')'
  );
  function_def := replace(
    function_def,
    '      ) <= target_tournament.pool_ends_on::text',
    '      ) <= target_tournament.pool_ends_on::text and false'
  );
  execute function_def;

  -- L'import des disponibilités finales ne doit pas fixer la période officielle
  -- des phases finales du tournoi. Celle-ci sera définie par le moteur natif
  -- lorsque les qualifiés seront connus.
  function_def := pg_get_functiondef(
    'public.admin_import_errebot_availability(uuid,jsonb)'::regprocedure
  );
  function_def := regexp_replace(
    function_def,
    'update public\.tournaments\s+set\s+finals_starts_on = finals_start,\s+finals_ends_on = finals_end,\s+ends_on = greatest\(ends_on, finals_end\),\s+updated_at = now\(\)\s+where id = target_tournament\.id;',
    'null;',
    'g'
  );
  execute function_def;
end;
$$;

commit;
