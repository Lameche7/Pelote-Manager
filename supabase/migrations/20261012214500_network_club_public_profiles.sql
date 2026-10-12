begin;
create table if not exists public.network_club_profiles (
 club_id uuid primary key references public.clubs(id) on delete cascade,
 is_published boolean not null default false,
 public_address text not null default '',
 public_email text not null default '',
 public_phone text not null default '',
 public_website text not null default '',
 public_description text not null default '',
 updated_at timestamptz not null default now()
);
alter table public.network_club_profiles enable row level security;
create policy network_club_profiles_public_select on public.network_club_profiles
 for select to anon, authenticated using (is_published);
create policy network_club_profiles_admin_select on public.network_club_profiles
 for select to authenticated using (public.has_club_permission(club_id,'club.manage'));
create policy network_club_profiles_admin_insert on public.network_club_profiles
 for insert to authenticated with check (public.has_club_permission(club_id,'club.manage'));
create policy network_club_profiles_admin_update on public.network_club_profiles
 for update to authenticated using (public.has_club_permission(club_id,'club.manage'))
 with check (public.has_club_permission(club_id,'club.manage'));
grant select on public.network_club_profiles to anon, authenticated;
grant insert,update on public.network_club_profiles to authenticated;
commit;
