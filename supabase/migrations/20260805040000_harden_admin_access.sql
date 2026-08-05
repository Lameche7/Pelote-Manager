begin;

-- Une instance Pelote Manager ne contient qu'un seul club métier.
-- Cette reprise aligne les anciens profils administrateurs avec la nouvelle
-- source de vérité fondée sur club_memberships et les permissions de club.
do $$
declare
  club_count integer;
  sole_club_id uuid;
  administrator_role_id uuid;
begin
  select count(*) into club_count from public.clubs;

  if club_count <> 1 then
    raise exception 'Admin access hardening requires exactly one club per instance'
      using errcode = 'P0003';
  end if;

  select id into sole_club_id from public.clubs;

  select id
  into administrator_role_id
  from public.club_roles
  where club_id = sole_club_id
    and key = 'administrator'::public.club_role_key;

  if administrator_role_id is null then
    raise exception 'Administrator club role not found'
      using errcode = 'P0002';
  end if;

  insert into public.club_memberships (club_id, profile_id, role_id)
  select sole_club_id, profiles.id, administrator_role_id
  from public.profiles as profiles
  where profiles.role = 'admin'::public.user_role
  on conflict (club_id, profile_id)
  do update set role_id = excluded.role_id;
end;
$$;

-- Les anciennes commandes d'administration utilisent encore ce prédicat.
-- Il repose désormais sur l'habilitation réelle du club et non sur profiles.role.
create or replace function public.is_profile_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_memberships as memberships
    join public.club_role_permissions as grants
      on grants.role_id = memberships.role_id
    where memberships.profile_id = auth.uid()
      and grants.permission_key = 'settings.manage'
  );
$$;

revoke all on function public.is_profile_admin() from public;
grant execute on function public.is_profile_admin() to authenticated;

create or replace function public.list_profiles_for_admin()
returns table (
  id uuid,
  email text,
  first_name text,
  last_name text,
  display_name text,
  role public.user_role,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
    raise exception 'Club administration permission required'
      using errcode = '42501';
  end if;

  return query
  select
    profiles.id,
    profiles.email,
    profiles.first_name,
    profiles.last_name,
    profiles.display_name,
    profiles.role,
    profiles.created_at,
    profiles.updated_at
  from public.profiles
  order by
    coalesce(profiles.display_name, profiles.last_name, profiles.first_name, profiles.email),
    profiles.email;
end;
$$;

revoke all on function public.list_profiles_for_admin() from public;
grant execute on function public.list_profiles_for_admin() to authenticated;

-- Le rôle applicatif et l'habilitation de club sont modifiés dans la même
-- transaction. Attribuer admin crée ou remplace l'appartenance administrateur ;
-- retirer admin supprime uniquement cette appartenance administrateur.
create or replace function public.set_profile_role(
  target_profile_id uuid,
  new_role public.user_role
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_club_id uuid;
  administrator_role_id uuid;
  updated_profile public.profiles;
begin
  actor_club_id := public.admin_current_club_id();

  if not public.has_club_permission(actor_club_id, 'settings.manage') then
    raise exception 'Club administration permission required'
      using errcode = '42501';
  end if;

  if target_profile_id = auth.uid() then
    raise exception 'Administrators cannot change their own role'
      using errcode = '42501';
  end if;

  perform set_config('app.allow_profile_role_update', 'on', true);

  update public.profiles
  set role = new_role,
      updated_at = now()
  where id = target_profile_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'Profile not found'
      using errcode = 'P0002';
  end if;

  if new_role = 'admin'::public.user_role then
    select id
    into administrator_role_id
    from public.club_roles
    where club_id = actor_club_id
      and key = 'administrator'::public.club_role_key;

    if administrator_role_id is null then
      raise exception 'Administrator club role not found'
        using errcode = 'P0002';
    end if;

    insert into public.club_memberships (club_id, profile_id, role_id)
    values (actor_club_id, target_profile_id, administrator_role_id)
    on conflict (club_id, profile_id)
    do update set role_id = excluded.role_id;
  else
    delete from public.club_memberships as memberships
    using public.club_roles as roles
    where memberships.club_id = actor_club_id
      and memberships.profile_id = target_profile_id
      and memberships.role_id = roles.id
      and roles.club_id = actor_club_id
      and roles.key = 'administrator'::public.club_role_key;
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.set_profile_role(uuid, public.user_role) from public;
grant execute on function public.set_profile_role(uuid, public.user_role) to authenticated;

commit;
