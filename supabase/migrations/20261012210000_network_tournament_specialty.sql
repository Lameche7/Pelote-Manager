begin;
-- Metadata intentionally published by a club's administrator to the network.
create table if not exists public.network_tournament_profiles (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  specialty text check (specialty in ('Trinquet','Mur à gauche','Fronton','Place libre','Autre')),
  updated_at timestamptz not null default now()
);
alter table public.network_tournament_profiles enable row level security;
create policy network_tournament_profiles_read on public.network_tournament_profiles
  for select to anon, authenticated using (
    exists (
      select 1 from public.tournaments t where t.id = tournament_id
        and t.status in ('pools_validated','planning_generated','planning_published','in_progress','completed','archived','registrations_open','registrations_closed')
    )
  );
create policy network_tournament_profiles_manage on public.network_tournament_profiles
  for all to authenticated
  using (exists (
    select 1 from public.tournaments t where t.id = tournament_id
      and public.has_club_permission(t.club_id,'club.manage')
  ))
  with check (exists (
    select 1 from public.tournaments t where t.id = tournament_id
      and public.has_club_permission(t.club_id,'club.manage')
  ));
grant select on public.network_tournament_profiles to anon, authenticated;
grant insert, update, delete on public.network_tournament_profiles to authenticated;
commit;
