-- DRAFT ONLY: do not apply until the platform Edge Function validates both sessions.
-- Grants are issued exclusively by the trusted backend, never by browser clients.
create schema if not exists pilotoki_private;
revoke all on schema pilotoki_private from public, anon, authenticated;

create table if not exists pilotoki_private.platform_admin_leases (
  business_user_id uuid primary key references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint platform_admin_lease_expiry check (expires_at <= created_at + interval '15 minutes')
);
revoke all on pilotoki_private.platform_admin_leases from public, anon, authenticated;
create index if not exists platform_admin_leases_expiry_idx
  on pilotoki_private.platform_admin_leases(expires_at);

-- Internal lookup; authenticated users cannot execute this directly.
create or replace function pilotoki_private.has_active_platform_lease(user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select user_id is not null and exists (
    select 1 from pilotoki_private.platform_admin_leases lease
    where lease.business_user_id = user_id
      and lease.revoked_at is null
      and lease.expires_at > now()
  );
$$;
revoke all on function pilotoki_private.has_active_platform_lease(uuid)
  from public, anon, authenticated;
grant execute on function pilotoki_private.has_active_platform_lease(uuid)
  to service_role;

-- Explicitly require service_role: this function is not a client API.
-- The Edge Function must independently verify the platform admin identity
-- and the matching business JWT before invoking it.
create or replace function public.issue_platform_admin_lease(
  target_business_user_id uuid,
  requested_seconds integer default 300
) returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare
  issued_expiry timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if target_business_user_id is null or requested_seconds not between 1 and 900 then
    raise exception 'Invalid lease request' using errcode = '22023';
  end if;
  issued_expiry := now() + make_interval(secs => requested_seconds);
  insert into pilotoki_private.platform_admin_leases
    (business_user_id, created_at, expires_at, revoked_at)
  values (target_business_user_id, now(), issued_expiry, null)
  on conflict (business_user_id) do update
    set created_at = now(), expires_at = excluded.expires_at, revoked_at = null;
  return issued_expiry;
end;
$$;
revoke all on function public.issue_platform_admin_lease(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.issue_platform_admin_lease(uuid, integer)
  to service_role;

create or replace function public.revoke_platform_admin_lease(
  target_business_user_id uuid
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update pilotoki_private.platform_admin_leases
  set revoked_at = now()
  where business_user_id = target_business_user_id;
end;
$$;
revoke all on function public.revoke_platform_admin_lease(uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_platform_admin_lease(uuid)
  to service_role;

-- Do NOT alter has_club_permission or get_my_club_access:
-- legacy admin mutation routes must never inherit platform-wide permissions.
-- Only the explicit-club, read-only dashboard RPCs call this guard.
create or replace function public.can_read_scoped_club_dashboard(target_club_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and target_club_id is not null
    and exists (select 1 from public.clubs c where c.id = target_club_id)
    and (
      public.has_club_permission(target_club_id, 'admin.dashboard.read')
      or pilotoki_private.has_active_platform_lease(auth.uid())
    );
$$;
revoke all on function public.can_read_scoped_club_dashboard(uuid)
  from public, anon, authenticated;
grant execute on function public.can_read_scoped_club_dashboard(uuid)
  to authenticated;

-- DRAFT: narrowly scoped information update. No generic table UPDATE grant.
-- All fields are whitelisted and the target club id is immutable.
create or replace function public.platform_admin_update_club_information(
  target_club_id uuid,
  changes jsonb
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $
declare
  result jsonb;
begin
  if auth.uid() is null
     or target_club_id is null
     or not pilotoki_private.has_active_platform_lease(auth.uid()) then
    raise exception 'Club information update denied' using errcode = '42501';
  end if;
  if changes is null
     or jsonb_typeof(changes) <> 'object'
     or changes = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(changes) as field(key)
       where field.key not in (
         'name', 'logo_url', 'hero_image_url',
         'primary_color', 'secondary_color', 'accent_color',
         'neutral_color', 'address', 'phone', 'email',
         'website', 'social_links', 'affiliation_number', 'notes'
       )
     ) then
    raise exception 'Invalid club information fields' using errcode = '22023';
  end if;

  update public.clubs c
  set name = case when changes ? 'name' then changes->>'name' else c.name end,
      logo_url = case when changes ? 'logo_url' then changes->>'logo_url' else c.logo_url end,
      hero_image_url = case when changes ? 'hero_image_url' then changes->>'hero_image_url' else c.hero_image_url end,
      primary_color = case when changes ? 'primary_color' then changes->>'primary_color' else c.primary_color end,
      secondary_color = case when changes ? 'secondary_color' then changes->>'secondary_color' else c.secondary_color end,
      accent_color = case when changes ? 'accent_color' then changes->>'accent_color' else c.accent_color end,
      neutral_color = case when changes ? 'neutral_color' then changes->>'neutral_color' else c.neutral_color end,
      address = case when changes ? 'address' then changes->>'address' else c.address end,
      phone = case when changes ? 'phone' then changes->>'phone' else c.phone end,
      email = case when changes ? 'email' then changes->>'email' else c.email end,
      website = case when changes ? 'website' then changes->>'website' else c.website end,
      social_links = case when changes ? 'social_links' then changes->>'social_links' else c.social_links end,
      affiliation_number = case when changes ? 'affiliation_number' then changes->>'affiliation_number' else c.affiliation_number end,
      notes = case when changes ? 'notes' then changes->>'notes' else c.notes end
  where c.id = target_club_id
  returning jsonb_build_object('id', c.id) into result;

  if result is null then
    raise exception 'Club information unavailable' using errcode = 'P0002';
  end if;
  return result;
end;
$;
revoke all on function public.platform_admin_update_club_information(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.platform_admin_update_club_information(uuid, jsonb)
  to authenticated;

-- DRAFT: a lease permits a narrowly scoped information read only.
-- No write privileges or implicit access to other business modules.
create or replace function public.platform_admin_get_club_information(
  target_club_id uuid
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  club_info jsonb;
begin
  if auth.uid() is null
     or target_club_id is null
     or not pilotoki_private.has_active_platform_lease(auth.uid()) then
    raise exception 'Club information access denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'logo_url', c.logo_url,
    'hero_image_url', c.hero_image_url,
    'primary_color', c.primary_color,
    'secondary_color', c.secondary_color,
    'accent_color', c.accent_color,
    'neutral_color', c.neutral_color,
    'address', c.address,
    'phone', c.phone,
    'email', c.email,
    'website', c.website,
    'social_links', c.social_links,
    'affiliation_number', c.affiliation_number,
    'notes', c.notes
  )
  into club_info
  from public.clubs c
  where c.id = target_club_id;

  if club_info is null then
    raise exception 'Club information unavailable' using errcode = 'P0002';
  end if;
  return club_info;
end;
$$;
revoke all on function public.platform_admin_get_club_information(uuid)
  from public, anon, authenticated;
grant execute on function public.platform_admin_get_club_information(uuid)
  to authenticated;
