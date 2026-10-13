begin;
-- Allow the Network metadata policies to inspect the tournament with definer privileges,
-- without granting clients direct SELECT on the internal tournaments table.
create or replace function public.network_tournament_profile_access(target_tournament_id uuid, require_management boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
select exists (
 select 1 from public.tournaments t
 where t.id = target_tournament_id
 and (case when require_management
 then (select auth.uid()) is not null and
      (public.has_club_permission(t.club_id, 'club.manage') or public.has_club_permission(t.club_id, 'tournaments.manage'))
 else t.status::text = any(array['pools_validated','planning_generated','planning_published','in_progress','completed','archived','registrations_open','registrations_closed'])
 end)
);
$$;
revoke all on function public.network_tournament_profile_access(uuid, boolean) from public,anon;
grant execute on function public.network_tournament_profile_access(uuid, boolean) to authenticated;
drop policy if exists network_tournament_profiles_read on public.network_tournament_profiles;
create policy network_tournament_profiles_read on public.network_tournament_profiles for select to anon,authenticated using (public.network_tournament_profile_access(tournament_id,false));
drop policy if exists network_tournament_profiles_manage on public.network_tournament_profiles;
drop policy if exists network_tournament_profiles_tournament_managers on public.network_tournament_profiles;
create policy network_tournament_profiles_manage on public.network_tournament_profiles for all to authenticated using (public.network_tournament_profile_access(tournament_id,true)) with check (public.network_tournament_profile_access(tournament_id,true));
grant execute on function public.network_tournament_profile_access(uuid, boolean) to anon;
commit;
