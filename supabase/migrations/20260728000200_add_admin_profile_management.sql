create function public.is_profile_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'::public.user_role
  );
$$;

revoke all on function public.is_profile_admin() from public;
grant execute on function public.is_profile_admin() to authenticated;

create function public.list_profiles_for_admin()
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
    raise exception 'Administrator role required'
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

create function public.set_profile_role(
  target_profile_id uuid,
  new_role public.user_role
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_profile public.profiles;
begin
  if not public.is_profile_admin() then
    raise exception 'Administrator role required'
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

  return updated_profile;
end;
$$;

revoke all on function public.set_profile_role(uuid, public.user_role) from public;
grant execute on function public.set_profile_role(uuid, public.user_role) to authenticated;

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated'
    and coalesce(current_setting('app.allow_profile_role_update', true), 'off') <> 'on'
  then
    if tg_op = 'INSERT' and new.role <> 'visitor'::public.user_role then
      raise exception 'Users cannot assign their own profile role'
        using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'Users cannot change their own profile role'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
