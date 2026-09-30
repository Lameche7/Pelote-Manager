begin;

create table if not exists public.club_reservation_settings (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  licensee_advance_hours integer not null default 72 check (licensee_advance_hours >= 0),
  public_advance_hours integer not null default 48 check (public_advance_hours >= 0),
  licensee_price_cents integer not null default 1200 check (licensee_price_cents >= 0),
  public_price_cents integer not null default 1800 check (public_price_cents >= 0),
  default_duration_minutes integer not null default 60 check (default_duration_minutes > 0),
  booking_step_minutes integer not null default 30 check (booking_step_minutes > 0),
  minimum_notice_minutes integer not null default 0 check (minimum_notice_minutes >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  licensee_max_active_reservations integer not null default 3 check (licensee_max_active_reservations > 0),
  public_max_active_reservations integer not null default 2 check (public_max_active_reservations > 0),
  cancellation_notice_hours integer not null default 24 check (cancellation_notice_hours >= 0),
  payment_mode text not null default 'test' check (payment_mode in ('test','helloasso')),
  online_payment_enabled boolean not null default false,
  split_payment_timeout_minutes integer not null default 45 check (split_payment_timeout_minutes > 0)
);

alter table public.club_reservation_settings enable row level security;

insert into public.club_reservation_settings (
  club_id, licensee_advance_hours, public_advance_hours,
  licensee_price_cents, public_price_cents, default_duration_minutes,
  booking_step_minutes, minimum_notice_minutes, updated_at, updated_by,
  licensee_max_active_reservations, public_max_active_reservations,
  cancellation_notice_hours, payment_mode, online_payment_enabled,
  split_payment_timeout_minutes
)
select
  club.id, legacy.licensee_advance_hours, legacy.public_advance_hours,
  legacy.licensee_price_cents, legacy.public_price_cents,
  legacy.default_duration_minutes, legacy.booking_step_minutes,
  legacy.minimum_notice_minutes, legacy.updated_at, legacy.updated_by,
  legacy.licensee_max_active_reservations,
  legacy.public_max_active_reservations,
  legacy.cancellation_notice_hours, legacy.payment_mode,
  legacy.online_payment_enabled, legacy.split_payment_timeout_minutes
from public.clubs as club
cross join public.reservation_settings as legacy
where legacy.id
on conflict (club_id) do nothing;

create or replace function public.initialize_club_reservation_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.club_reservation_settings(club_id)
  values (new.id)
  on conflict (club_id) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_club_reservation_settings on public.clubs;
create trigger initialize_club_reservation_settings
after insert on public.clubs
for each row
execute function public.initialize_club_reservation_settings();

revoke all on function public.initialize_club_reservation_settings()
from public, anon, authenticated;

create or replace function public.is_active_licensee_for_club(
  target_profile_id uuid,
  target_club_id uuid,
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
    from public.club_members as member
    join public.club_seasons as season
      on season.club_id = member.club_id
     and season.is_active
    join public.club_member_seasons as member_season
      on member_season.club_member_id = member.id
     and member_season.club_season_id = season.id
    where member.id =
      public.profile_club_member_id(target_profile_id, target_club_id)
      and member.club_id = target_club_id
      and member.is_active
      and member_season.is_licensed
      and season.starts_on <= target_date
      and season.ends_on >= target_date
  );
$$;

revoke all on function public.is_active_licensee_for_club(uuid, uuid, date)
from public, anon, authenticated;
grant execute on function public.is_active_licensee_for_club(uuid, uuid, date)
to authenticated;

create or replace function public.get_reservation_terms_for_resource(
  target_resource_id uuid,
  target_user_id uuid,
  target_starts_at timestamptz
)
returns table(
  customer_type public.reservation_customer_type,
  advance_hours integer,
  price_cents integer,
  max_active_reservations integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  target_timezone text;
  settings public.club_reservation_settings%rowtype;
  active_licensee boolean;
begin
  select resource.club_id, resource.timezone
  into target_club_id, target_timezone
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null then
    raise exception 'Ressource introuvable' using errcode = 'P0002';
  end if;

  select *
  into strict settings
  from public.club_reservation_settings
  where club_id = target_club_id;

  active_licensee := target_user_id is not null
    and public.is_active_licensee_for_club(
      target_user_id,
      target_club_id,
      (target_starts_at at time zone target_timezone)::date
    );

  if active_licensee then
    return query select
      'licensee'::public.reservation_customer_type,
      settings.licensee_advance_hours,
      settings.licensee_price_cents,
      settings.licensee_max_active_reservations;
  elsif target_user_id is not null then
    return query select
      'account'::public.reservation_customer_type,
      settings.public_advance_hours,
      settings.public_price_cents,
      settings.public_max_active_reservations;
  else
    return query select
      'guest'::public.reservation_customer_type,
      settings.public_advance_hours,
      settings.public_price_cents,
      settings.public_max_active_reservations;
  end if;
end;
$$;

revoke all on function public.get_reservation_terms_for_resource(uuid, uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.get_reservation_terms_for_resource(uuid, uuid, timestamptz)
to anon, authenticated;

create or replace function public.get_current_reservation_terms_for_resource(
  target_resource_id uuid,
  target_starts_at timestamptz
)
returns table(
  customer_type public.reservation_customer_type,
  advance_hours integer,
  price_cents integer,
  max_active_reservations integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.get_reservation_terms_for_resource(
    target_resource_id,
    auth.uid(),
    target_starts_at
  );
$$;

revoke all on function public.get_current_reservation_terms_for_resource(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.get_current_reservation_terms_for_resource(uuid, timestamptz)
to anon, authenticated;

create or replace function public.get_reservation_payment_config(
  target_resource_id uuid
)
returns table(enabled boolean, mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select settings.online_payment_enabled, settings.payment_mode
  from public.reservable_resources as resource
  join public.club_reservation_settings as settings
    on settings.club_id = resource.club_id
  where resource.id = target_resource_id
    and resource.is_active;
$$;

revoke all on function public.get_reservation_payment_config(uuid)
from public, anon, authenticated;
grant execute on function public.get_reservation_payment_config(uuid)
to anon, authenticated;

create or replace function public.get_reservation_payment_config_for_payment(
  target_payment_id uuid
)
returns table(enabled boolean, mode text)
language sql
stable
security definer
set search_path = ''
as $$
  select settings.online_payment_enabled, settings.payment_mode
  from public.payments as payment
  join public.reservations as reservation
    on reservation.id = payment.reservation_id
  join public.reservable_resources as resource
    on resource.id = reservation.resource_id
  join public.club_reservation_settings as settings
    on settings.club_id = resource.club_id
  where payment.id = target_payment_id
    and (
      payment.payer_profile_id = auth.uid()
      or reservation.user_id = auth.uid()
    );
$$;

revoke all on function public.get_reservation_payment_config_for_payment(uuid)
from public, anon, authenticated;
grant execute on function public.get_reservation_payment_config_for_payment(uuid)
to authenticated;

create or replace function public.admin_get_reservation_settings()
returns table(
  licensee_advance_hours integer, public_advance_hours integer,
  licensee_price_cents integer, public_price_cents integer,
  default_duration_minutes integer, booking_step_minutes integer,
  minimum_notice_minutes integer, cancellation_notice_hours integer,
  licensee_max_active_reservations integer,
  public_max_active_reservations integer,
  online_payment_enabled boolean, payment_mode text,
  split_payment_timeout_minutes integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if target_club_id is null
    or not public.has_club_permission(target_club_id, 'reservations.manage')
  then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  return query
  select
    settings.licensee_advance_hours, settings.public_advance_hours,
    settings.licensee_price_cents, settings.public_price_cents,
    settings.default_duration_minutes, settings.booking_step_minutes,
    settings.minimum_notice_minutes, settings.cancellation_notice_hours,
    settings.licensee_max_active_reservations,
    settings.public_max_active_reservations,
    settings.online_payment_enabled, settings.payment_mode,
    settings.split_payment_timeout_minutes
  from public.club_reservation_settings as settings
  where settings.club_id = target_club_id;
end;
$$;

create or replace function public.admin_update_reservation_settings(
  new_licensee_advance_hours integer,
  new_public_advance_hours integer,
  new_licensee_price_cents integer,
  new_public_price_cents integer,
  new_default_duration_minutes integer,
  new_booking_step_minutes integer,
  new_minimum_notice_minutes integer,
  new_cancellation_notice_hours integer,
  new_licensee_max_active_reservations integer,
  new_public_max_active_reservations integer,
  new_online_payment_enabled boolean,
  new_payment_mode text,
  new_split_payment_timeout_minutes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if target_club_id is null
    or not public.has_club_permission(target_club_id, 'reservations.manage')
  then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if new_licensee_advance_hours < 0
    or new_public_advance_hours < 0
    or new_licensee_price_cents < 0
    or new_public_price_cents < 0
    or new_default_duration_minutes <= 0
    or new_booking_step_minutes <= 0
    or new_minimum_notice_minutes < 0
    or new_cancellation_notice_hours < 0
    or new_licensee_max_active_reservations <= 0
    or new_public_max_active_reservations <= 0
    or new_payment_mode not in ('test', 'helloasso')
    or new_split_payment_timeout_minutes <= 0
  then
    raise exception 'Les paramètres de réservation sont invalides'
      using errcode = '22023';
  end if;

  update public.club_reservation_settings
  set
    licensee_advance_hours = new_licensee_advance_hours,
    public_advance_hours = new_public_advance_hours,
    licensee_price_cents = new_licensee_price_cents,
    public_price_cents = new_public_price_cents,
    default_duration_minutes = new_default_duration_minutes,
    booking_step_minutes = new_booking_step_minutes,
    minimum_notice_minutes = new_minimum_notice_minutes,
    cancellation_notice_hours = new_cancellation_notice_hours,
    licensee_max_active_reservations = new_licensee_max_active_reservations,
    public_max_active_reservations = new_public_max_active_reservations,
    online_payment_enabled = new_online_payment_enabled,
    payment_mode = new_payment_mode,
    split_payment_timeout_minutes = new_split_payment_timeout_minutes,
    updated_at = now(),
    updated_by = auth.uid()
  where club_id = target_club_id;
end;
$$;

create or replace function public.admin_get_reservation_prices()
returns table(licensee_price_cents integer, public_price_cents integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if target_club_id is null
    or not public.has_club_permission(target_club_id, 'pricing.manage')
  then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  return query
  select settings.licensee_price_cents, settings.public_price_cents
  from public.club_reservation_settings as settings
  where settings.club_id = target_club_id;
end;
$$;

create or replace function public.admin_update_reservation_prices(
  new_licensee_price_cents integer,
  new_public_price_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if target_club_id is null
    or not public.has_club_permission(target_club_id, 'pricing.manage')
  then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  if new_licensee_price_cents is null
    or new_public_price_cents is null
    or new_licensee_price_cents < 0
    or new_public_price_cents < 0
  then
    raise exception 'Les tarifs sont invalides' using errcode = '22023';
  end if;

  update public.club_reservation_settings
  set licensee_price_cents = new_licensee_price_cents,
      public_price_cents = new_public_price_cents,
      updated_at = now(),
      updated_by = auth.uid()
  where club_id = target_club_id;
end;
$$;

revoke all on function public.admin_get_reservation_settings()
from public, anon, authenticated;
grant execute on function public.admin_get_reservation_settings()
to authenticated;

revoke all on function public.admin_update_reservation_settings(
  integer, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, boolean, text, integer
)
from public, anon, authenticated;
grant execute on function public.admin_update_reservation_settings(
  integer, integer, integer, integer, integer, integer, integer, integer,
  integer, integer, boolean, text, integer
)
to authenticated;

revoke all on function public.admin_get_reservation_prices()
from public, anon, authenticated;
grant execute on function public.admin_get_reservation_prices()
to authenticated;

revoke all on function public.admin_update_reservation_prices(integer, integer)
from public, anon, authenticated;
grant execute on function public.admin_update_reservation_prices(integer, integer)
to authenticated;

commit;
