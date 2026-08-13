-- Keep public member verification and final account linking aligned and unambiguous.
--
-- These legacy RPC signatures deliberately use parameter names that are also column
-- names. Always qualify function parameters through the function name to prevent
-- PostgreSQL from resolving an unqualified identifier as a table column (or raising
-- SQLSTATE 42702 in PL/pgSQL).

create or replace function public.find_member_by_licence(
  licence_number text,
  last_name text,
  first_name text,
  birth_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_members as member
    where member.licence_number_normalized =
          public.normalize_member_licence(find_member_by_licence.licence_number)
      and member.last_name_normalized =
          public.normalize_member_identity(find_member_by_licence.last_name)
      and member.first_name_normalized =
          public.normalize_member_identity(find_member_by_licence.first_name)
      and member.birth_date = find_member_by_licence.birth_date
  );
$$;

revoke all on function public.find_member_by_licence(text, text, text, date) from public;
grant execute on function public.find_member_by_licence(text, text, text, date) to anon, authenticated;

create or replace function public.link_profile_to_member(
  licence_number text,
  last_name text,
  first_name text,
  birth_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  target_member_id uuid;
  linked_profile_id uuid;
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if nullif(btrim(link_profile_to_member.licence_number), '') is null
    or nullif(btrim(link_profile_to_member.last_name), '') is null
    or nullif(btrim(link_profile_to_member.first_name), '') is null
    or link_profile_to_member.birth_date is null
  then
    raise exception 'Complete member identity is required' using errcode = '22023';
  end if;

  select members.id
  into target_member_id
  from public.club_members as members
  where members.licence_number_normalized =
        public.normalize_member_licence(link_profile_to_member.licence_number)
    and members.last_name_normalized =
        public.normalize_member_identity(link_profile_to_member.last_name)
    and members.first_name_normalized =
        public.normalize_member_identity(link_profile_to_member.first_name)
    and members.birth_date = link_profile_to_member.birth_date
  for update;

  if target_member_id is null then
    raise exception 'Member identity does not match the club licence registry'
      using errcode = 'P0002';
  end if;

  select profiles.id
  into linked_profile_id
  from public.profiles
  where profiles.member_id = target_member_id;

  if linked_profile_id is not null and linked_profile_id <> current_profile_id then
    raise exception 'Licence is already linked to another account'
      using errcode = '23505';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = current_profile_id
  ) then
    raise exception 'Current profile not found' using errcode = 'P0002';
  end if;

  perform set_config('app.allow_profile_member_link', 'on', true);

  update public.profiles
  set member_id = target_member_id,
      updated_at = now()
  where id = current_profile_id;

  return target_member_id;
end;
$$;

revoke all on function public.link_profile_to_member(text, text, text, date) from public;
grant execute on function public.link_profile_to_member(text, text, text, date) to authenticated;
