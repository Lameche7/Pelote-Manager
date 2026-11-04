-- Track review decisions from the independent super-admin platform.
-- These flags do not grant club access, subscription or payment rights.
alter table public.network_club_registration_requests
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by_platform_user_id uuid;

comment on column public.network_club_registration_requests.reviewed_by_platform_user_id
  is 'Central platform Auth user ID; deliberately not a cross-project foreign key.';

revoke all on public.network_club_registration_requests
  from public, anon, authenticated;
