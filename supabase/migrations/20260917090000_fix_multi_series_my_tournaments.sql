begin;

-- Un même joueur peut participer à plusieurs séries du même tournoi.
-- get_my_tournaments() ne doit donc pas réduire ses équipes à une seule ligne
-- par tournoi : chaque équipe liée au profil doit produire sa propre carte.
do $$
declare
  current_definition text;
  patched_definition text;
begin
  current_definition := pg_get_functiondef(
    'public.get_my_tournaments()'::regprocedure
  );

  if position(
    'select distinct on (team.tournament_id)' in current_definition
  ) = 0 then
    raise exception
      'get_my_tournaments() ne contient plus la déduplication attendue';
  end if;

  patched_definition := replace(
    current_definition,
    'select distinct on (team.tournament_id)',
    'select'
  );

  execute patched_definition;
end;
$$;

revoke all on function public.get_my_tournaments()
from public, anon, authenticated;
grant execute on function public.get_my_tournaments() to authenticated;

commit;
