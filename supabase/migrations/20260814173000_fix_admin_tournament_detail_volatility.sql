begin;

-- admin_get_tournament() synchronise automatiquement l'état des inscriptions
-- et peut donc effectuer des écritures. Le wrapper ajouté pour le minimum de
-- phase finale ne doit pas être déclaré STABLE, sinon PostgreSQL refuse ces
-- écritures à l'exécution lors de l'ouverture d'un tournoi côté admin.
alter function public.admin_get_tournament_with_finals_minimum(uuid) volatile;

commit;
