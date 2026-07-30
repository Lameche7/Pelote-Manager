-- This migration prepares club isolation and permission-based administration.
-- It deliberately keeps a single active club in the UI: multi-club switching and
-- tenant provisioning are not implemented by this PR. No implicit club fallback
-- is allowed; every administrative access is backed by an explicit membership.
create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  logo_url text,
  address text,
  phone text,
  email text,
  website text,
  social_links text,
  affiliation_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.clubs (name, slug)
values ('Pelotaris Club Lourdais', 'pelotaris-club-lourdais');

create type public.club_role_key as enum (
  'administrator',
  'reservation_manager',
  'tournament_manager',
  'communication_manager',
  'treasurer'
);

create table public.permissions (
  key text primary key,
  description text not null
);
create table public.club_roles (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  key public.club_role_key not null,
  name text not null,
  unique (club_id, key)
);
create table public.club_role_permissions (
  role_id uuid not null references public.club_roles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);
create table public.club_memberships (
  club_id uuid not null references public.clubs (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.club_roles (id),
  created_at timestamptz not null default now(),
  primary key (club_id, profile_id)
);

insert into public.permissions (key, description)
values
  ('admin.dashboard.read', 'Consulter le tableau de bord'),
  ('club.manage', 'Gérer les informations du club'),
  ('reservations.manage', 'Gérer les réservations, horaires et fermetures'),
  ('members.manage', 'Gérer les membres'),
  ('events.manage', 'Gérer les évènements'),
  ('tournaments.manage', 'Gérer les tournois'),
  ('communication.manage', 'Gérer la communication'),
  ('statistics.read', 'Consulter les statistiques'),
  ('payments.read', 'Consulter les paiements'),
  ('payments.manage', 'Gérer les opérations financières'),
  ('pricing.manage', 'Gérer les tarifs'),
  ('settings.manage', 'Gérer les paramètres et habilitations');

insert into public.club_roles (club_id, key, name)
select clubs.id, templates.key, templates.name
from public.clubs
cross join (values
  ('administrator'::public.club_role_key, 'Administrateur'),
  ('reservation_manager'::public.club_role_key, 'Responsable Réservations'),
  ('tournament_manager'::public.club_role_key, 'Responsable Tournois'),
  ('communication_manager'::public.club_role_key, 'Responsable Communication'),
  ('treasurer'::public.club_role_key, 'Trésorier')
) as templates (key, name);

insert into public.club_role_permissions (role_id, permission_key)
select roles.id, permissions.key
from public.club_roles as roles
cross join public.permissions
where roles.key = 'administrator';

insert into public.club_role_permissions (role_id, permission_key)
select roles.id, permissions.key
from public.club_roles as roles
join public.permissions on
  (roles.key = 'reservation_manager' and permissions.key in ('admin.dashboard.read', 'reservations.manage'))
  or (roles.key = 'tournament_manager' and permissions.key in ('admin.dashboard.read', 'tournaments.manage'))
  or (roles.key = 'communication_manager' and permissions.key in ('admin.dashboard.read', 'communication.manage'))
  or (roles.key = 'treasurer' and permissions.key in (
    'admin.dashboard.read', 'statistics.read', 'payments.read', 'payments.manage', 'pricing.manage'
  ));

-- Only current administrators are explicitly attached to the initial club.
-- Future accounts must receive a club membership; no club is inferred for them.
insert into public.club_memberships (club_id, profile_id, role_id)
select clubs.id, profiles.id, roles.id
from public.clubs
join public.club_roles as roles
  on roles.club_id = clubs.id and roles.key = 'administrator'
cross join public.profiles
where profiles.role = 'admin';

create table public.club_seasons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (club_id, name)
);
create unique index club_seasons_one_active
on public.club_seasons (club_id) where is_active;

create table public.club_prices (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  audience text not null default 'all' check (audience in ('all', 'member', 'public')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (club_id, name)
);

alter table public.reservable_resources
add column club_id uuid references public.clubs (id);
update public.reservable_resources
set club_id = clubs.id
from public.clubs
where clubs.slug = 'pelotaris-club-lourdais';
alter table public.reservable_resources alter column club_id set not null;

alter table public.club_members
add column club_id uuid references public.clubs (id);
update public.club_members
set club_id = clubs.id
from public.clubs
where clubs.slug = 'pelotaris-club-lourdais';
alter table public.club_members alter column club_id set not null;

create function public.has_club_permission(target_club_id uuid, target_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_memberships as memberships
    join public.club_role_permissions as grants on grants.role_id = memberships.role_id
    where memberships.club_id = target_club_id
      and memberships.profile_id = auth.uid()
      and grants.permission_key = target_permission
  );
$$;

create function public.admin_current_club_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  club_ids uuid[];
begin
  select array_agg(memberships.club_id order by memberships.club_id)
  into club_ids
  from public.club_memberships as memberships
  where memberships.profile_id = auth.uid();

  if coalesce(array_length(club_ids, 1), 0) = 0 then
    raise exception 'No club membership' using errcode = '42501';
  end if;
  if array_length(club_ids, 1) > 1 then
    raise exception 'Club selection required' using errcode = 'P0003';
  end if;
  return club_ids[1];
end;
$$;

create function public.get_my_club_access()
returns table (club_id uuid, club_name text, permission_keys text[])
language sql
stable
security definer
set search_path = ''
as $$
  select clubs.id, clubs.name, array_agg(grants.permission_key order by grants.permission_key)
  from public.club_memberships as memberships
  join public.clubs as clubs on clubs.id = memberships.club_id
  join public.club_role_permissions as grants on grants.role_id = memberships.role_id
  where memberships.profile_id = auth.uid()
  group by clubs.id, clubs.name;
$$;

revoke all on function public.has_club_permission(uuid, text) from public;
revoke all on function public.admin_current_club_id() from public;
revoke all on function public.get_my_club_access() from public;
grant execute on function public.has_club_permission(uuid, text) to authenticated;
grant execute on function public.admin_current_club_id() to authenticated;
grant execute on function public.get_my_club_access() to authenticated;

create function public.admin_update_calendar_closure(
  target_id uuid,
  target_title text,
  target_starts_at timestamptz,
  target_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
begin
  select resources.club_id into target_club_id
  from public.calendar_occupations as occupations
  join public.reservable_resources as resources on resources.id = occupations.resource_id
  where occupations.id = target_id
    and occupations.occupation_type <> 'reservation';

  if target_club_id is null
    or not public.has_club_permission(target_club_id, 'reservations.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if btrim(target_title) = '' or target_ends_at <= target_starts_at then
    raise exception 'Invalid closure' using errcode = '22023';
  end if;

  update public.calendar_occupations
  set title = btrim(target_title), starts_at = target_starts_at,
      ends_at = target_ends_at, updated_at = now(), updated_by = auth.uid()
  where id = target_id;
end;
$$;
revoke all on function public.admin_update_calendar_closure(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.admin_update_calendar_closure(uuid, text, timestamptz, timestamptz) to authenticated;

alter table public.clubs enable row level security;
alter table public.permissions enable row level security;
alter table public.club_roles enable row level security;
alter table public.club_role_permissions enable row level security;
alter table public.club_memberships enable row level security;
alter table public.club_seasons enable row level security;
alter table public.club_prices enable row level security;

create policy clubs_member_read on public.clubs for select to authenticated
using (exists (select 1 from public.club_memberships where club_id = clubs.id and profile_id = auth.uid()));
create policy clubs_authorized_update on public.clubs for update to authenticated
using (public.has_club_permission(id, 'club.manage'))
with check (public.has_club_permission(id, 'club.manage'));

create policy club_seasons_authorized_all on public.club_seasons for all to authenticated
using (public.has_club_permission(club_id, 'club.manage'))
with check (public.has_club_permission(club_id, 'club.manage'));
create policy club_prices_authorized_all on public.club_prices for all to authenticated
using (public.has_club_permission(club_id, 'pricing.manage'))
with check (public.has_club_permission(club_id, 'pricing.manage'));

create policy permissions_member_read on public.permissions for select to authenticated
using (exists (select 1 from public.club_memberships where profile_id = auth.uid()));
create policy club_roles_member_read on public.club_roles for select to authenticated
using (exists (select 1 from public.club_memberships where club_id = club_roles.club_id and profile_id = auth.uid()));
create policy club_roles_authorized_all on public.club_roles for all to authenticated
using (public.has_club_permission(club_id, 'settings.manage'))
with check (public.has_club_permission(club_id, 'settings.manage'));
create policy club_role_permissions_member_read on public.club_role_permissions for select to authenticated
using (exists (
  select 1 from public.club_roles
  join public.club_memberships on club_memberships.club_id = club_roles.club_id
  where club_roles.id = club_role_permissions.role_id and club_memberships.profile_id = auth.uid()
));
create policy club_memberships_own_read on public.club_memberships for select to authenticated
using (profile_id = auth.uid() or public.has_club_permission(club_id, 'settings.manage'));
create policy club_memberships_authorized_all on public.club_memberships for all to authenticated
using (public.has_club_permission(club_id, 'settings.manage'))
with check (public.has_club_permission(club_id, 'settings.manage'));
