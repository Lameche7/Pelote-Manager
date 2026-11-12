-- Étape préparatoire : contrôle explicite du club cible.
-- Ne reconnaît pas encore les sessions super-admin de la plateforme.
-- Ne modifie aucune RPC historique ni politique RLS.
create or replace function public.can_administer_club(
  target_club_id uuid,
  required_permission text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    auth.uid() is not null
    and target_club_id is not null
    and required_permission is not null
    and public.has_club_permission(target_club_id, required_permission);
$function$;

revoke all on function public.can_administer_club(uuid, text) from public;
revoke all on function public.can_administer_club(uuid, text) from anon;
grant execute on function public.can_administer_club(uuid, text) to authenticated;

comment on function public.can_administer_club(uuid, text)
  is 'Contrôle le club cible et la permission explicite du membre. Aucun accès inter-projets super-admin accordé.';
