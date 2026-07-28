create extension if not exists btree_gist with schema extensions;

create type public.membership_status as enum (
  'pending',
  'active',
  'expired',
  'suspended'
);

create type public.reservation_status as enum (
  'draft',
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'refused',
  'expired',
  'no_show'
);

create type public.reservation_customer_type as enum (
  'guest',
  'account',
  'licensee'
);

create type public.occupation_type as enum (
  'reservation',
  'match',
  'closure',
  'maintenance',
  'club_event',
  'animation'
);

alter table public.profiles
add column membership_status public.membership_status not null default 'pending',
add column membership_valid_until date,
add column membership_validated_at timestamptz,
add column membership_validated_by uuid references public.profiles (id);

create table public.reservation_settings (
  id boolean primary key default true check (id),
  licensee_advance_hours integer not null default 72 check (licensee_advance_hours >= 0),
  public_advance_hours integer not null default 48 check (public_advance_hours >= 0),
  licensee_price_cents integer not null default 1200 check (licensee_price_cents >= 0),
  public_price_cents integer not null default 1800 check (public_price_cents >= 0),
  default_duration_minutes integer not null default 60 check (default_duration_minutes > 0),
  booking_step_minutes integer not null default 30 check (booking_step_minutes > 0),
  minimum_notice_minutes integer not null default 0 check (minimum_notice_minutes >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

insert into public.reservation_settings (id)
values (true);

create table public.reservable_resources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  timezone text not null default 'Europe/Paris',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservable_resources_name_not_blank check (btrim(name) <> '')
);

create unique index reservable_resources_unique_active_name
on public.reservable_resources (lower(name))
where is_active;

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.reservable_resources (id),
  user_id uuid references public.profiles (id),
  guest_name text,
  guest_email text,
  guest_phone text,
  customer_type public.reservation_customer_type not null,
  status public.reservation_status not null default 'pending',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint reservations_valid_period check (ends_at > starts_at),
  constraint reservations_customer_identity check (
    (user_id is not null and guest_email is null)
    or
    (user_id is null and guest_email is not null and btrim(guest_email) <> '')
  ),
  constraint reservations_licensee_requires_account check (
    customer_type <> 'licensee' or user_id is not null
  )
);

create table public.calendar_occupations (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.reservable_resources (id),
  occupation_type public.occupation_type not null,
  reservation_id uuid unique references public.reservations (id),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint calendar_occupations_valid_period check (ends_at > starts_at),
  constraint calendar_occupations_reservation_link check (
    (occupation_type = 'reservation' and reservation_id is not null)
    or
    (occupation_type <> 'reservation' and reservation_id is null)
  ),
  constraint calendar_occupations_no_overlap exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (cancelled_at is null)
);

create table public.reservation_audit_log (
  id bigint generated always as identity primary key,
  reservation_id uuid not null references public.reservations (id),
  action text not null,
  actor_id uuid references public.profiles (id),
  previous_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now(),
  constraint reservation_audit_log_action_not_blank check (btrim(action) <> '')
);

create index reservations_user_id_created_at_idx
on public.reservations (user_id, created_at desc);

create index reservations_resource_starts_at_idx
on public.reservations (resource_id, starts_at);

create index calendar_occupations_resource_starts_at_idx
on public.calendar_occupations (resource_id, starts_at)
where cancelled_at is null;

create function public.is_active_licensee(
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
    where id = target_profile_id
      and membership_status = 'active'::public.membership_status
      and membership_validated_at is not null
      and membership_validated_by is not null
      and (
        membership_valid_until is null
        or membership_valid_until >= target_date
      )
  );
$$;

revoke all on function public.is_active_licensee(uuid, date) from public;
grant execute on function public.is_active_licensee(uuid, date) to anon, authenticated;

alter table public.reservation_settings enable row level security;
alter table public.reservable_resources enable row level security;
alter table public.reservations enable row level security;
alter table public.calendar_occupations enable row level security;
alter table public.reservation_audit_log enable row level security;

create policy reservable_resources_public_read
on public.reservable_resources
for select
to anon, authenticated
using (is_active);

create policy calendar_occupations_public_read
on public.calendar_occupations
for select
to anon, authenticated
using (cancelled_at is null);

create policy reservations_owner_read
on public.reservations
for select
to authenticated
using (user_id = auth.uid());

create policy reservation_audit_admin_read
on public.reservation_audit_log
for select
to authenticated
using (public.is_profile_admin());
