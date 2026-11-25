-- Server-authoritative permission check for tournament planning.
create or replace function public.can_manage_tournament_planning_for_club(target_club_id uuid)
returns boolean language sql stable security definer set search_path to ''
as $function$
select auth.uid() is not null and target_club_id is not null
and (coalesce(public.can_administer_club(target_club_id,'tournaments.manage'),false)
or coalesce(pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false));
$function$;
revoke all on function public.can_manage_tournament_planning_for_club(uuid) from public, anon, authenticated;
grant execute on function public.can_manage_tournament_planning_for_club(uuid) to authenticated;