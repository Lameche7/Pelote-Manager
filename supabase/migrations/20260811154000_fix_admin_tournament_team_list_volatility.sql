begin;

-- admin_list_tournament_teams_v3 encapsule la projection historique qui peut
-- synchroniser les statuts d'inscription. Elle ne peut donc pas être STABLE.
alter function public.admin_list_tournament_teams_v3(uuid)
volatile;

commit;
