begin;
-- Tournament managers can publish the specialty of tournaments belonging to their club.
-- Existing read and club.manage policies remain untouched.
create policy network_tournament_profiles_tournament_managers
on public.network_tournament_profiles
for all to authenticated
using (
  exists (
    select 1 from public.tournaments t
    where t.id = tournament_id
      and public.has_club_permission(t.club_id, 'tournaments.manage')
  )
)
with check (
  exists (
    select 1 from public.tournaments t
    where t.id = tournament_id
      and public.has_club_permission(t.club_id, 'tournaments.manage')
  )
);
commit;
