do $do$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.admin_import_championship_sources(jsonb)'::regprocedure
  )
  into function_definition;

  function_definition := replace(
    function_definition,
    $old$when v_candidate_profile_id is null then 'unlinked'
          else 'verified'$old$,
    $new$when v_candidate_profile_id is null then 'unlinked'::public.championship_player_link_status
          else 'verified'::public.championship_player_link_status$new$
  );

  execute function_definition;
end;
$do$;
