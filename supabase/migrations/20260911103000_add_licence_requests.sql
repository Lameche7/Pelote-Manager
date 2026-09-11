begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'licence_request_type') then
    create type public.licence_request_type as enum ('renewal', 'first_application');
  end if;
  if not exists (select 1 from pg_type where typname = 'licence_request_status') then
    create type public.licence_request_status as enum (
      'pending_documents',
      'pending_payment',
      'ready_for_review',
      'document_rejected',
      'approved',
      'licensed',
      'cancelled'
    );
  end if;
end $$;

create table if not exists public.licence_campaigns (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  club_season_id uuid not null references public.club_seasons(id) on delete cascade,
  is_open boolean not null default false,
  opens_at timestamptz,
  closes_at timestamptz,
  renewal_price_cents integer not null default 0 check (renewal_price_cents >= 0),
  first_application_price_cents integer not null default 0 check (first_application_price_cents >= 0),
  application_form_path text,
  instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  unique (club_id, club_season_id),
  check (closes_at is null or opens_at is null or closes_at > opens_at)
);

create table if not exists public.licence_requests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.licence_campaigns(id) on delete restrict,
  club_id uuid not null references public.clubs(id) on delete restrict,
  club_season_id uuid not null references public.club_seasons(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  club_member_id uuid references public.club_members(id) on delete restrict,
  request_type public.licence_request_type not null,
  status public.licence_request_status not null default 'pending_documents',
  amount_cents integer not null check (amount_cents >= 0),
  first_name text not null,
  last_name text not null,
  birth_date date,
  gender text check (gender is null or gender in ('male', 'female')),
  email text not null,
  phone text,
  document_path text,
  document_original_name text,
  document_mime_type text,
  document_uploaded_at timestamptz,
  rejection_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  licensed_at timestamptz,
  licensed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, profile_id),
  check (
    (request_type = 'renewal' and club_member_id is not null)
    or request_type = 'first_application'
  )
);

create index if not exists licence_requests_club_status_idx
  on public.licence_requests (club_id, status, created_at desc);
create index if not exists licence_requests_profile_idx
  on public.licence_requests (profile_id, created_at desc);

alter table public.licence_campaigns enable row level security;
alter table public.licence_requests enable row level security;
revoke all on table public.licence_campaigns from anon, authenticated;
revoke all on table public.licence_requests from anon, authenticated;

alter table public.payments alter column reservation_id drop not null;
alter table public.payments add column if not exists licence_request_id uuid
  references public.licence_requests(id) on delete restrict;
alter table public.payments add column if not exists payment_context text not null default 'reservation';
alter table public.payments drop constraint if exists payments_context_check;
alter table public.payments add constraint payments_context_check check (
  (payment_context = 'reservation' and reservation_id is not null and licence_request_id is null)
  or
  (payment_context = 'licence' and reservation_id is null and licence_request_id is not null)
);

create unique index if not exists payments_one_paid_per_licence_request_idx
  on public.payments (licence_request_id)
  where licence_request_id is not null and status = 'paid';
create unique index if not exists payments_one_open_per_licence_request_idx
  on public.payments (licence_request_id)
  where licence_request_id is not null and status in ('pending', 'authorized');
create index if not exists payments_licence_request_created_at_idx
  on public.payments (licence_request_id, created_at desc)
  where licence_request_id is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'licence-documents',
  'licence-documents',
  false,
  10485760,
  array['application/pdf','image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists licence_documents_player_insert on storage.objects;
create policy licence_documents_player_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'requests'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1 from public.licence_requests request
    where request.id::text = (storage.foldername(name))[3]
      and request.profile_id = (select auth.uid())
  )
);

drop policy if exists licence_documents_player_select on storage.objects;
create policy licence_documents_player_select
on storage.objects for select to authenticated
using (
  bucket_id = 'licence-documents'
  and (
    (
      (storage.foldername(name))[1] = 'requests'
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and exists (
        select 1 from public.licence_requests request
        where request.id::text = (storage.foldername(name))[3]
          and request.profile_id = (select auth.uid())
      )
    )
    or (
      (storage.foldername(name))[1] = 'templates'
      and exists (
        select 1 from public.licence_campaigns campaign
        where campaign.application_form_path = storage.objects.name
      )
    )
    or exists (
      select 1 from public.licence_requests request
      where request.document_path = storage.objects.name
        and public.has_club_permission(request.club_id, 'members.manage')
    )
  )
);

drop policy if exists licence_documents_player_update on storage.objects;
create policy licence_documents_player_update
on storage.objects for update to authenticated
using (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'requests'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1 from public.licence_requests request
    where request.id::text = (storage.foldername(name))[3]
      and request.profile_id = (select auth.uid())
      and request.status not in ('approved', 'licensed', 'cancelled')
  )
)
with check (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'requests'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

drop policy if exists licence_documents_player_delete on storage.objects;
create policy licence_documents_player_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'requests'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and exists (
    select 1 from public.licence_requests request
    where request.id::text = (storage.foldername(name))[3]
      and request.profile_id = (select auth.uid())
      and request.status not in ('approved', 'licensed', 'cancelled')
  )
);

drop policy if exists licence_documents_admin_insert on storage.objects;
create policy licence_documents_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'templates'
  and exists (
    select 1 from public.clubs club
    where club.id::text = (storage.foldername(name))[2]
      and public.has_club_permission(club.id, 'members.manage')
  )
);

drop policy if exists licence_documents_admin_update on storage.objects;
create policy licence_documents_admin_update
on storage.objects for update to authenticated
using (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'templates'
  and exists (
    select 1 from public.clubs club
    where club.id::text = (storage.foldername(name))[2]
      and public.has_club_permission(club.id, 'members.manage')
  )
)
with check (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'templates'
  and exists (
    select 1 from public.clubs club
    where club.id::text = (storage.foldername(name))[2]
      and public.has_club_permission(club.id, 'members.manage')
  )
);

drop policy if exists licence_documents_admin_delete on storage.objects;
create policy licence_documents_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'licence-documents'
  and (storage.foldername(name))[1] = 'templates'
  and exists (
    select 1 from public.clubs club
    where club.id::text = (storage.foldername(name))[2]
      and public.has_club_permission(club.id, 'members.manage')
  )
);

commit;
