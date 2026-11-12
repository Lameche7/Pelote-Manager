-- Première brique de sécurité multi-club.
-- Cette fonction n'accorde AUCUN privilège de super-administrateur.
-- Elle ne valide que les habilitations réellement détenues par auth.uid().
-- Aucun changement de politique RLS ni des RPC admin existantes.

create or replace function public.my_club_has_permission(
  target_club_id uuid,
  required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    auth.uid() is not null
    and target_club_id is not null
    and required_permission is not null
    and exists (
      select 1
      from public.club_memberships as membership
      join public.club_role_permissions as permission
        on permission.role_id = membership.role_id
      where membership.profile_id = auth.uid()
        and membership.club_id = target_club_id
        and permission.permission_key = required_permission
    );
$function$;

revoke all on function public.my_club_has_permission(uuid, text) from public;
revoke all on function public.my_club_has_permission(uuid, text) from anon;
grant execute on function public.my_club_has_permission(uuid, text) to authenticated;

comment on function public.my_club_has_permission(uuid, text)
  is 'Vérifie une permission explicite du membre authentifié pour un club précis. Ne donne aucun droit de plateforme.';
