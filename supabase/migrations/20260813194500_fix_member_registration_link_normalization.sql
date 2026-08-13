-- Keep the final member-account link aligned with the public licence verification.
-- The verification RPC already accepts normalized identity values; the link RPC must
-- use the exact same rules so case, accents, spaces, apostrophes and hyphens cannot
-- make step 2 fail after step 1 succeeded.
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

  if nullif(btrim(licence_number), '') is null
    or nullif(btrim(last_name), '') is null
    or nullif(btrim(first_name), '') is null
    or birth_date is null
  then
    raise exception 'Complete member identity is required' using errcode = '22023';
  end if;

  select members.id
  into target_member_id
  from public.club_members as members
  where members.licence_number_normalized = public.normalize_member_licence(licence_number)
    and members.last_name_normalized = public.normalize_member_identity(last_name)
    and members.first_name_normalized = public.normalize_member_identity(first_name)
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

  -- The profile trigger only allows member_id changes through this controlled RPC.
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
