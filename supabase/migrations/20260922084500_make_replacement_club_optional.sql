begin;

do $migration$
declare
  function_definition text;
  patched_definition text;
  old_fragment text := $old$
  if replacement_first_name = ''
    or replacement_last_name = ''
    or replacement_club_name = ''
    or replacement_email = ''
    or replacement_phone = '' then
    raise exception 'Tournament replacement player fields are incomplete'
      using errcode = '22023';
  end if;
$old$;
  new_fragment text := $new$
  if replacement_first_name = ''
    or replacement_last_name = ''
    or replacement_email = ''
    or replacement_phone = '' then
    raise exception 'Tournament replacement player fields are incomplete'
      using errcode = '22023';
  end if;
$new$;
begin
  function_definition := replace(
    pg_get_functiondef(
      'public.admin_replace_tournament_player(uuid,text,jsonb,text)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position(old_fragment in function_definition) = 0 then
    raise exception 'Replacement club guard changed unexpectedly';
  end if;

  patched_definition := replace(function_definition, old_fragment, new_fragment);
  execute patched_definition;
end;
$migration$;

comment on function public.admin_replace_tournament_player(uuid, text, jsonb, text) is
  'Remplace atomiquement un joueur sans modifier la série, la poule, le planning ni les matchs. Le club du remplaçant est facultatif ; prénom, nom, email et téléphone restent obligatoires.';

commit;
