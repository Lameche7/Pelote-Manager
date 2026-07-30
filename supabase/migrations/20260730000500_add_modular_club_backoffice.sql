-- Back-office foundations. Club ownership is explicit so every new aggregate can
-- later be isolated by tenant without changing its identity or API.
create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  logo_url text, address text, phone text, email text, website text,
  social_links text, affiliation_number text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

insert into public.clubs (name, slug, affiliation_number)
values ('Pelotaris Club Lourdais', 'pelotaris-club-lourdais', null);

create type public.club_role_key as enum ('administrator','reservation_manager','tournament_manager','communication_manager','treasurer');
create table public.permissions (key text primary key, description text not null);
create table public.club_roles (id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id) on delete cascade, key public.club_role_key not null, name text not null, unique(club_id,key));
create table public.club_role_permissions (role_id uuid not null references public.club_roles(id) on delete cascade, permission_key text not null references public.permissions(key) on delete cascade, primary key(role_id,permission_key));
create table public.club_memberships (club_id uuid not null references public.clubs(id) on delete cascade, profile_id uuid not null references public.profiles(id) on delete cascade, role_id uuid not null references public.club_roles(id), created_at timestamptz not null default now(), primary key(club_id,profile_id));

insert into public.permissions(key,description) values
 ('admin.dashboard.read','Consulter le tableau de bord'),('club.manage','Gérer le club'),('reservations.manage','Gérer les réservations'),('members.manage','Gérer les membres'),('events.manage','Gérer les évènements'),('tournaments.manage','Gérer les tournois'),('communication.manage','Gérer la communication'),('statistics.read','Consulter les statistiques'),('settings.manage','Gérer les paramètres');
insert into public.club_roles(club_id,key,name) select id,key,name from public.clubs cross join (values ('administrator'::public.club_role_key,'Administrateur'),('reservation_manager','Responsable Réservations'),('tournament_manager','Responsable Tournois'),('communication_manager','Responsable Communication'),('treasurer','Trésorier')) roles(key,name);
insert into public.club_role_permissions(role_id,permission_key) select r.id,p.key from public.club_roles r cross join public.permissions p where r.key='administrator';
insert into public.club_role_permissions select r.id,p.key from public.club_roles r join public.permissions p on (r.key='reservation_manager' and p.key in ('admin.dashboard.read','reservations.manage')) or (r.key='tournament_manager' and p.key in ('admin.dashboard.read','tournaments.manage')) or (r.key='communication_manager' and p.key in ('admin.dashboard.read','communication.manage')) or (r.key='treasurer' and p.key in ('admin.dashboard.read','statistics.read','settings.manage'));
insert into public.club_memberships(club_id,profile_id,role_id) select c.id,p.id,r.id from public.clubs c join public.club_roles r on r.club_id=c.id and r.key='administrator' cross join public.profiles p where p.role='admin';

create table public.club_seasons (id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id) on delete cascade, name text not null check(btrim(name)<>''), starts_on date not null, ends_on date not null, is_active boolean not null default false, created_at timestamptz not null default now(), check(ends_on>=starts_on), unique(club_id,name));
create unique index club_seasons_one_active on public.club_seasons(club_id) where is_active;
create table public.club_prices (id uuid primary key default gen_random_uuid(), club_id uuid not null references public.clubs(id) on delete cascade, name text not null check(btrim(name)<>''), amount_cents integer not null check(amount_cents>=0), currency text not null default 'EUR' check(currency='EUR'), audience text not null default 'all' check(audience in ('all','member','public')), is_active boolean not null default true, created_at timestamptz not null default now(), unique(club_id,name));

alter table public.reservable_resources add column club_id uuid references public.clubs(id);
update public.reservable_resources set club_id=(select id from public.clubs limit 1); alter table public.reservable_resources alter column club_id set not null;
alter table public.club_members add column club_id uuid references public.clubs(id);
update public.club_members set club_id=(select id from public.clubs limit 1); alter table public.club_members alter column club_id set not null;

create function public.admin_current_club_id() returns uuid language sql stable security definer set search_path='' as $$ select coalesce((select club_id from public.club_memberships where profile_id=auth.uid() limit 1),(select id from public.clubs limit 1)) where public.is_profile_admin() $$;
revoke all on function public.admin_current_club_id() from public; grant execute on function public.admin_current_club_id() to authenticated;

alter table public.clubs enable row level security; alter table public.permissions enable row level security; alter table public.club_roles enable row level security; alter table public.club_role_permissions enable row level security; alter table public.club_memberships enable row level security; alter table public.club_seasons enable row level security; alter table public.club_prices enable row level security;
create policy clubs_admin_all on public.clubs for all to authenticated using(public.is_profile_admin()) with check(public.is_profile_admin());
create policy club_seasons_admin_all on public.club_seasons for all to authenticated using(public.is_profile_admin()) with check(public.is_profile_admin());
create policy club_prices_admin_all on public.club_prices for all to authenticated using(public.is_profile_admin()) with check(public.is_profile_admin());
create policy permissions_authenticated_read on public.permissions for select to authenticated using(true);
create policy club_roles_member_read on public.club_roles for select to authenticated using(exists(select 1 from public.club_memberships m where m.club_id=club_roles.club_id and m.profile_id=auth.uid()));
create policy club_role_permissions_member_read on public.club_role_permissions for select to authenticated using(exists(select 1 from public.club_roles r join public.club_memberships m on m.club_id=r.club_id where r.id=club_role_permissions.role_id and m.profile_id=auth.uid()));
create policy club_memberships_own_read on public.club_memberships for select to authenticated using(profile_id=auth.uid() or public.is_profile_admin());
