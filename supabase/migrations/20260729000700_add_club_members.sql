create table public.club_members (
  id uuid primary key default gen_random_uuid(),
  licence_number text not null unique,
  last_name text not null,
  first_name text not null,
  birth_date date,
  email text,
  phone text,
  gender text,
  ranking text,
  category text,
  season text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_members_licence_number_not_blank check (btrim(licence_number) <> ''),
  constraint club_members_last_name_not_blank check (btrim(last_name) <> ''),
  constraint club_members_first_name_not_blank check (btrim(first_name) <> ''),
  constraint club_members_season_not_blank check (btrim(season) <> '')
);

alter table public.profiles
add column member_id uuid unique references public.club_members (id) on delete restrict;

comment on column public.profiles.member_id is
  'Optional during the migration period; the account-creation flow must link new profiles to a club member.';

create index club_members_active_season_idx
on public.club_members (season, last_name, first_name)
where is_active;

alter table public.club_members enable row level security;

create policy club_members_owner_read
on public.club_members
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.member_id = club_members.id
  )
);

create policy club_members_admin_all
on public.club_members
for all
to authenticated
using (public.is_profile_admin())
with check (public.is_profile_admin());

create function public.find_member_by_licence(licence_number text)
returns table (
  id uuid,
  last_name text,
  first_name text,
  birth_date date,
  season text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if licence_number is null or btrim(licence_number) = '' then
    raise exception 'Licence number is required' using errcode = '22023';
  end if;

  return query
  select
    members.id,
    members.last_name,
    members.first_name,
    members.birth_date,
    members.season,
    members.is_active
  from public.club_members as members
  where members.licence_number = btrim(find_member_by_licence.licence_number);
end;
$$;

revoke all on function public.find_member_by_licence(text) from public;
grant execute on function public.find_member_by_licence(text) to authenticated;

create function public.link_profile_to_member(licence_number text)
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

  if licence_number is null or btrim(licence_number) = '' then
    raise exception 'Licence number is required' using errcode = '22023';
  end if;

  select members.id
  into target_member_id
  from public.club_members as members
  where members.licence_number = btrim(link_profile_to_member.licence_number)
  for update;

  if target_member_id is null then
    raise exception 'Licence not found' using errcode = 'P0002';
  end if;

  select profiles.id
  into linked_profile_id
  from public.profiles
  where profiles.member_id = target_member_id;

  if linked_profile_id is not null and linked_profile_id <> current_profile_id then
    raise exception 'Licence is already linked to another account'
      using errcode = '23505';
  end if;

  if not exists (select 1 from public.profiles where id = current_profile_id) then
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

revoke all on function public.link_profile_to_member(text) from public;
grant execute on function public.link_profile_to_member(text) to authenticated;

create function public.protect_profile_member_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated'
    and not public.is_profile_admin()
    and coalesce(current_setting('app.allow_profile_member_link', true), 'off') <> 'on'
    and new.member_id is distinct from old.member_id
  then
    raise exception 'Member links must be managed through link_profile_to_member'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_profile_member_link
before update of member_id on public.profiles
for each row execute function public.protect_profile_member_link();

revoke all on function public.protect_profile_member_link() from public;

create or replace function public.is_active_licensee(
  target_profile_id uuid,
  target_date date default current_date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    left join public.club_members
      on club_members.id = profiles.member_id
    where profiles.id = target_profile_id
      and (
        club_members.is_active
        or (
          profiles.member_id is null
          and profiles.membership_status = 'active'::public.membership_status
          and profiles.membership_validated_at is not null
          and profiles.membership_validated_by is not null
          and (
            profiles.membership_valid_until is null
            or profiles.membership_valid_until >= target_date
          )
        )
      )
  );
$$;

revoke all on function public.is_active_licensee(uuid, date) from public;
grant execute on function public.is_active_licensee(uuid, date) to anon, authenticated;
