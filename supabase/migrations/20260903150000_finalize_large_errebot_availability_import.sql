begin;

-- Le classeur réel Bizanos a mis en évidence trois particularités à conserver
-- dans le chemin de migration final :
-- 1. les grilles de disponibilités de poules et de phases finales peuvent se
--    chevaucher sans définir les dates officielles du tableau final ;
-- 2. un même créneau physique peut être proposé dans les deux grilles et ne doit
--    être stocké qu'une fois pour une équipe ;
-- 3. le validateur historique doit qualifier external_team_id après sa jointure.
--
-- Les fonctions ont été réécrites plusieurs fois dans PR129. Cette migration
-- finale garantit que la dernière définition installée possède bien les règles
-- validées avec le classeur réel, y compris pour le chemin de repli historique.

do $$
declare
  function_def text;
  patched_def text;
begin
  -- Preview compacte : une grille de disponibilités finales peut commencer
  -- avant la fin globale des poules.
  function_def := pg_get_functiondef(
    'public.admin_preview_errebot_availability_import_compact(uuid,jsonb)'::regprocedure
  );

  if position(
    ') <= target_tournament.pool_ends_on and false'
    in function_def
  ) = 0 then
    patched_def := replace(
      function_def,
      ') <= target_tournament.pool_ends_on',
      ') <= target_tournament.pool_ends_on and false'
    );

    if patched_def = function_def then
      raise exception 'Compact preview finals-overlap patch target not found';
    end if;

    execute patched_def;
  end if;

  -- Import compact : fusionne les disponibilités identiques présentes dans les
  -- deux grilles et ne modifie pas la période officielle des phases finales.
  function_def := pg_get_functiondef(
    'public.admin_import_errebot_availability_compact(uuid,jsonb)'::regprocedure
  );

  if position(
    E'select distinct\n    selected.team_id'
    in function_def
  ) = 0 then
    patched_def := regexp_replace(
      function_def,
      '(insert into public\.tournament_team_availability_slots[[:space:]]*\([[:space:]]*team_id,[[:space:]]*tournament_id,[[:space:]]*play_date,[[:space:]]*starts_at,[[:space:]]*ends_at[[:space:]]*\)[[:space:]]*)select[[:space:]]+',
      E'\\1select distinct\n  ',
      'i'
    );

    if patched_def = function_def then
      raise exception 'Compact import availability dedupe patch target not found';
    end if;

    function_def := patched_def;
  end if;

  if position('finals_starts_on = finals_start' in function_def) > 0 then
    patched_def := regexp_replace(
      function_def,
      'update public\.tournaments[[:space:]]+set[[:space:]]+finals_starts_on = finals_start,[[:space:]]+finals_ends_on = finals_end,[[:space:]]+ends_on = greatest\(ends_on, finals_end\),[[:space:]]+updated_at = now\(\)[[:space:]]+where id = target_tournament_id;',
      'null;',
      'g'
    );

    if patched_def = function_def then
      raise exception 'Compact import finals-date patch target not found';
    end if;

    function_def := patched_def;
  end if;

  execute function_def;

  -- Chemin historique utilisé en repli par le client : conserve les mêmes
  -- protections pour qu'un payload non compact reste valide.
  function_def := pg_get_functiondef(
    'public.validate_errebot_availability_import_payload(uuid,jsonb)'::regprocedure
  );

  if position(
    'declaration_input.external_team_id <> '''''
    in function_def
  ) = 0 then
    patched_def := regexp_replace(
      function_def,
      'team_refs\.team_id,[[:space:]]+\([[:space:]]+external_team_id <> ''''[[:space:]]+and phase in \(''pools'', ''finals''\)[[:space:]]+\) as shape_valid',
      E'team_refs.team_id,\n      (\n        declaration_input.external_team_id <> ''''\n        and declaration_input.phase in (''pools'', ''finals'')\n      ) as shape_valid',
      'g'
    );

    if patched_def = function_def then
      raise exception 'Legacy validator ambiguity patch target not found';
    end if;

    function_def := patched_def;
  end if;

  if position(
    ') <= target_tournament.pool_ends_on::text and false'
    in function_def
  ) = 0 then
    function_def := replace(
      function_def,
      ') <= target_tournament.pool_ends_on::text',
      ') <= target_tournament.pool_ends_on::text and false'
    );
  end if;

  execute function_def;

  function_def := pg_get_functiondef(
    'public.admin_import_errebot_availability(uuid,jsonb)'::regprocedure
  );

  if position(
    E'select distinct\n    (value->>''team_id'')::uuid'
    in function_def
  ) = 0 then
    patched_def := regexp_replace(
      function_def,
      '(insert into public\.tournament_team_availability_slots[[:space:]]*\([[:space:]]*team_id,[[:space:]]*tournament_id,[[:space:]]*play_date,[[:space:]]*starts_at,[[:space:]]*ends_at[[:space:]]*\)[[:space:]]*)select[[:space:]]+',
      E'\\1select distinct\n  ',
      'i'
    );

    if patched_def = function_def then
      raise exception 'Legacy import availability dedupe patch target not found';
    end if;

    function_def := patched_def;
  end if;

  if position('finals_starts_on = finals_start' in function_def) > 0 then
    patched_def := regexp_replace(
      function_def,
      'update public\.tournaments[[:space:]]+set[[:space:]]+finals_starts_on = finals_start,[[:space:]]+finals_ends_on = finals_end,[[:space:]]+ends_on = greatest\(ends_on, finals_end\),[[:space:]]+updated_at = now\(\)[[:space:]]+where id = target_tournament\.id;',
      'null;',
      'g'
    );

    if patched_def = function_def then
      raise exception 'Legacy import finals-date patch target not found';
    end if;

    function_def := patched_def;
  end if;

  execute function_def;
end;
$$;

commit;
