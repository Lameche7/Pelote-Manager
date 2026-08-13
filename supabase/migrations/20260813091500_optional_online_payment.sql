alter table public.reservation_settings
add column if not exists online_payment_enabled boolean not null default false;

update public.reservation_settings
set online_payment_enabled = false,
    cancellation_notice_hours = 8,
    updated_at = now()
where id;

alter table public.reservations
add column if not exists payment_required boolean not null default false;

update public.reservations as reservation
set payment_required = exists (
  select 1 from public.payments as payment
  where payment.reservation_id = reservation.id
);

create or replace function public.get_online_payment_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select settings.online_payment_enabled
  from public.reservation_settings as settings
  where settings.id;
$$;

revoke all on function public.get_online_payment_enabled() from public;
grant execute on function public.get_online_payment_enabled() to anon, authenticated;

create or replace function public.create_reservation_record(
  target_resource_id uuid,
  target_starts_at timestamptz,
  guest_name text default null,
  guest_email text default null,
  guest_phone text default null
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  settings public.reservation_settings%rowtype;
  target_ends_at timestamptz;
  terms record;
  created_reservation public.reservations;
begin
  select * into strict settings
  from public.reservation_settings where id;

  target_ends_at := target_starts_at
    + make_interval(mins => settings.default_duration_minutes);

  if actor_id is null and (
    nullif(btrim(guest_name), '') is null
    or nullif(btrim(guest_email), '') is null
    or nullif(btrim(guest_phone), '') is null
  ) then
    raise exception 'Nom, adresse électronique et téléphone sont obligatoires'
      using errcode = '22023';
  end if;

  select * into strict terms
  from public.assert_reservation_slot_allowed(
    target_resource_id,
    actor_id,
    target_starts_at,
    target_ends_at,
    null
  );

  insert into public.reservations (
    resource_id, user_id, guest_name, guest_email, guest_phone,
    customer_type, status, starts_at, ends_at, price_cents,
    payment_required, created_by, updated_by
  ) values (
    target_resource_id,
    actor_id,
    case when actor_id is null then btrim(guest_name) end,
    case when actor_id is null then lower(btrim(guest_email)) end,
    case when actor_id is null then btrim(guest_phone) end,
    terms.customer_type,
    'confirmed',
    target_starts_at,
    target_ends_at,
    terms.price_cents,
    false,
    actor_id,
    actor_id
  ) returning * into created_reservation;

  insert into public.calendar_occupations (
    resource_id, occupation_type, reservation_id, title,
    starts_at, ends_at, created_by, updated_by
  ) values (
    target_resource_id,
    'reservation',
    created_reservation.id,
    'Réservation',
    target_starts_at,
    target_ends_at,
    actor_id,
    actor_id
  );

  insert into public.reservation_audit_log (
    reservation_id, action, actor_id, new_data
  ) values (
    created_reservation.id,
    'created',
    actor_id,
    to_jsonb(created_reservation)
  );

  return created_reservation;
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d''être réservé par une autre personne'
      using errcode = '23P01';
end;
$$;

revoke all on function public.create_reservation_record(uuid, timestamptz, text, text, text)
from public, anon, authenticated;

create or replace function public.create_reservation(
  target_resource_id uuid,
  target_starts_at timestamptz,
  guest_name text default null,
  guest_email text default null,
  guest_phone text default null
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select online_payment_enabled from public.reservation_settings where id) then
    raise exception 'Le paiement en ligne est activé pour les réservations'
      using errcode = 'P0001';
  end if;

  return public.create_reservation_record(
    target_resource_id,
    target_starts_at,
    guest_name,
    guest_email,
    guest_phone
  );
end;
$$;

revoke all on function public.create_reservation(uuid, timestamptz, text, text, text)
from public;
grant execute on function public.create_reservation(uuid, timestamptz, text, text, text)
to anon, authenticated;

create or replace function public.reserve_for_payment(
  target_resource_id uuid,
  target_starts_at timestamptz,
  guest_name text default null,
  guest_email text default null,
  guest_phone text default null
)
returns table (
  reservation_id uuid,
  payment_id uuid,
  amount_cents integer,
  currency text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_reservation public.reservations;
  created_payment public.payments;
begin
  if not (select online_payment_enabled from public.reservation_settings where id) then
    raise exception 'Le paiement en ligne est désactivé' using errcode = 'P0001';
  end if;

  created_reservation := public.create_reservation_record(
    target_resource_id,
    target_starts_at,
    guest_name,
    guest_email,
    guest_phone
  );

  update public.reservations
  set status = 'pending',
      payment_required = true,
      payment_status = 'pending',
      updated_at = now(),
      updated_by = auth.uid()
  where id = created_reservation.id
  returning * into created_reservation;

  insert into public.payments (
    reservation_id, amount_cents, currency, metadata
  ) values (
    created_reservation.id,
    created_reservation.price_cents,
    created_reservation.currency,
    jsonb_build_object('reservation_id', created_reservation.id)
  ) returning * into created_payment;

  insert into public.reservation_audit_log (
    reservation_id, action, actor_id, new_data
  ) values (
    created_reservation.id,
    'payment_started',
    auth.uid(),
    jsonb_build_object('payment_id', created_payment.id)
  );

  return query select
    created_reservation.id,
    created_payment.id,
    created_payment.amount_cents,
    created_payment.currency,
    created_payment.expires_at;
end;
$$;

revoke all on function public.reserve_for_payment(uuid, timestamptz, text, text, text)
from public;
grant execute on function public.reserve_for_payment(uuid, timestamptz, text, text, text)
to anon, authenticated;

drop function if exists public.admin_get_reservation_settings();

create function public.admin_get_reservation_settings()
returns table (
  licensee_advance_hours integer,
  public_advance_hours integer,
  licensee_price_cents integer,
  public_price_cents integer,
  default_duration_minutes integer,
  booking_step_minutes integer,
  minimum_notice_minutes integer,
  cancellation_notice_hours integer,
  licensee_max_active_reservations integer,
  public_max_active_reservations integer,
  online_payment_enabled boolean,
  payment_mode text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  return query
  select
    settings.licensee_advance_hours,
    settings.public_advance_hours,
    settings.licensee_price_cents,
    settings.public_price_cents,
    settings.default_duration_minutes,
    settings.booking_step_minutes,
    settings.minimum_notice_minutes,
    settings.cancellation_notice_hours,
    settings.licensee_max_active_reservations,
    settings.public_max_active_reservations,
    settings.online_payment_enabled,
    settings.payment_mode
  from public.reservation_settings as settings
  where settings.id;
end;
$$;

revoke all on function public.admin_get_reservation_settings() from public;
grant execute on function public.admin_get_reservation_settings() to authenticated;

drop function if exists public.admin_update_reservation_settings(
  integer, integer, integer, integer, integer,
  integer, integer, integer, integer, text
);

create function public.admin_update_reservation_settings(
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
  new_payment_mode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
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
    or new_payment_mode not in ('test', 'helloasso') then
    raise exception 'Les paramètres de réservation sont invalides'
      using errcode = '22023';
  end if;

  update public.reservation_settings
  set licensee_advance_hours = new_licensee_advance_hours,
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
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

revoke all on function public.admin_update_reservation_settings(
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, boolean, text
) from public;
grant execute on function public.admin_update_reservation_settings(
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, boolean, text
) to authenticated;
