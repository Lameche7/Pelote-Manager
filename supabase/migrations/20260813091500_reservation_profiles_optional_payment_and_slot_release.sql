begin;

-- Reservation UX V2:
-- - active licence status comes from club_members.is_active;
-- - online payment is optional and disabled by default;
-- - customer cancellation deadline defaults to H-8;
-- - cancelling a reservation publishes a short-lived notification to active licensees.

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
  select 1
  from public.payments as payment
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

-- Internal creation primitive. It is deliberately not executable by API roles.
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
  select *
  into strict settings
  from public.reservation_settings
  where id;

  target_ends_at := target_starts_at
    + make_interval(mins => settings.default_duration_minutes);

  if actor_id is null then
    if nullif(btrim(guest_name), '') is null
      or nullif(btrim(guest_email), '') is null
      or nullif(btrim(guest_phone), '') is null then
      raise exception 'Nom, adresse électronique et téléphone sont obligatoires'
        using errcode = '22023';
    end if;
  end if;

  select *
  into strict terms
  from public.assert_reservation_slot_allowed(
    target_resource_id,
    actor_id,
    target_starts_at,
    target_ends_at,
    null
  );

  insert into public.reservations (
    resource_id,
    user_id,
    guest_name,
    guest_email,
    guest_phone,
    customer_type,
    status,
    starts_at,
    ends_at,
    price_cents,
    payment_required,
    created_by,
    updated_by
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
  )
  returning * into created_reservation;

  insert into public.calendar_occupations (
    resource_id,
    occupation_type,
    reservation_id,
    title,
    starts_at,
    ends_at,
    created_by,
    updated_by
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
    reservation_id,
    action,
    actor_id,
    new_data
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

revoke all on function public.create_reservation_record(
  uuid,
  timestamptz,
  text,
  text,
  text
) from public, anon, authenticated;

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
declare
  payment_enabled boolean;
begin
  select settings.online_payment_enabled
  into strict payment_enabled
  from public.reservation_settings as settings
  where settings.id;

  if payment_enabled then
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

revoke all on function public.create_reservation(
  uuid,
  timestamptz,
  text,
  text,
  text
) from public;
grant execute on function public.create_reservation(
  uuid,
  timestamptz,
  text,
  text,
  text
) to anon, authenticated;

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
  settings public.reservation_settings%rowtype;
  created_reservation public.reservations;
  created_payment public.payments;
begin
  select *
  into strict settings
  from public.reservation_settings
  where id;

  if not settings.online_payment_enabled then
    raise exception 'Le paiement en ligne est désactivé'
      using errcode = 'P0001';
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
    reservation_id,
    amount_cents,
    currency,
    metadata
  ) values (
    created_reservation.id,
    created_reservation.price_cents,
    created_reservation.currency,
    jsonb_build_object('reservation_id', created_reservation.id)
  ) returning * into created_payment;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    new_data
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

-- The notification uses the existing Communication delivery model, so active
-- licensees with an account receive it in Mon espace > Notifications.
create or replace function public.publish_released_reservation_slot_notification(
  target_reservation_id uuid,
  excluded_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_row public.reservations;
  resource_row public.reservable_resources;
  communication_id uuid;
  local_slot text;
begin
  select *
  into reservation_row
  from public.reservations
  where id = target_reservation_id;

  if reservation_row.id is null or reservation_row.starts_at <= now() then
    return null;
  end if;

  select *
  into resource_row
  from public.reservable_resources
  where id = reservation_row.resource_id;

  if resource_row.id is null then
    return null;
  end if;

  local_slot := to_char(
    reservation_row.starts_at at time zone resource_row.timezone,
    'DD/MM/YYYY "à" HH24:MI'
  );

  insert into public.club_communications (
    club_id,
    title,
    body,
    priority,
    status,
    show_on_home,
    published_at,
    expires_at,
    created_by,
    updated_by
  ) values (
    resource_row.club_id,
    'Créneau libéré · ' || resource_row.name,
    'Un créneau vient de se libérer le ' || local_slot
      || ' au ' || resource_row.name || '. Il est de nouveau disponible à la réservation.',
    'normal',
    'published',
    false,
    now(),
    reservation_row.starts_at,
    excluded_profile_id,
    excluded_profile_id
  )
  returning id into communication_id;

  insert into public.communication_deliveries (
    communication_id,
    club_id,
    club_member_id,
    profile_id_at_publication,
    email_snapshot,
    email_status
  )
  select
    communication_id,
    resource_row.club_id,
    member.id,
    profile.id,
    coalesce(nullif(btrim(member.email), ''), nullif(btrim(profile.email), '')),
    case
      when coalesce(nullif(btrim(member.email), ''), nullif(btrim(profile.email), '')) is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from public.club_members as member
  left join public.profiles as profile on profile.member_id = member.id
  where member.club_id = resource_row.club_id
    and member.is_active
    and (excluded_profile_id is null or profile.id is distinct from excluded_profile_id)
  on conflict (communication_id, club_member_id) do nothing;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  ) values (
    resource_row.club_id,
    communication_id,
    'published',
    excluded_profile_id,
    jsonb_build_object(
      'source', 'reservation_cancelled',
      'reservation_id', target_reservation_id,
      'recipient_count', (
        select count(*)
        from public.communication_deliveries
        where communication_deliveries.communication_id = publish_released_reservation_slot_notification.communication_id
      )
    )
  );

  return communication_id;
end;
$$;

revoke all on function public.publish_released_reservation_slot_notification(uuid, uuid)
from public, anon, authenticated;

create or replace function public.cancel_reservation(
  target_reservation_id uuid,
  cancellation_reason text default null
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_reservation public.reservations;
  cancelled_reservation public.reservations;
  notice_hours integer;
  actor_is_admin boolean := public.is_profile_admin();
begin
  if actor_id is null then
    raise exception 'Authentification requise' using errcode = '42501';
  end if;

  select *
  into existing_reservation
  from public.reservations
  where id = target_reservation_id
  for update;

  if existing_reservation.id is null then
    raise exception 'Réservation introuvable' using errcode = 'P0002';
  end if;

  if existing_reservation.user_id is distinct from actor_id
    and not actor_is_admin then
    raise exception 'Annulation interdite' using errcode = '42501';
  end if;

  if existing_reservation.status = 'cancelled' then
    return existing_reservation;
  end if;

  if existing_reservation.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut plus être annulée'
      using errcode = 'P0001';
  end if;

  if not actor_is_admin then
    select settings.cancellation_notice_hours
    into strict notice_hours
    from public.reservation_settings as settings
    where settings.id;

    if now() > existing_reservation.starts_at - make_interval(hours => notice_hours) then
      raise exception 'Le délai d’annulation en ligne est dépassé'
        using errcode = '22023';
    end if;
  end if;

  update public.reservations
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = actor_id,
      cancellation_reason = nullif(btrim(cancellation_reason), ''),
      updated_at = now(),
      updated_by = actor_id
  where id = target_reservation_id
  returning * into cancelled_reservation;

  update public.calendar_occupations
  set cancelled_at = now(),
      updated_at = now(),
      updated_by = actor_id
  where reservation_id = target_reservation_id
    and cancelled_at is null;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    target_reservation_id,
    'cancelled',
    actor_id,
    to_jsonb(existing_reservation),
    to_jsonb(cancelled_reservation)
  );

  perform public.publish_released_reservation_slot_notification(
    target_reservation_id,
    actor_id
  );

  return cancelled_reservation;
end;
$$;

revoke all on function public.cancel_reservation(uuid, text) from public;
grant execute on function public.cancel_reservation(uuid, text) to authenticated;

create or replace function public.cancel_my_reservation(target_reservation_id uuid)
returns table (
  reservation_id uuid,
  reservation_status public.reservation_status,
  payment_status public.payment_status,
  refund_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_row public.reservations;
  cancelled_row public.reservations;
  requires_refund boolean;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select *
  into reservation_row
  from public.reservations
  where id = target_reservation_id
    and user_id = auth.uid();

  if reservation_row.id is null then
    raise exception 'Réservation introuvable' using errcode = 'P0002';
  end if;

  requires_refund := reservation_row.payment_required
    and reservation_row.payment_status = 'paid';

  cancelled_row := public.cancel_reservation(
    target_reservation_id,
    'Annulation en ligne par le réservant'
  );

  update public.payments
  set status = 'cancelled',
      failure_reason = coalesce(failure_reason, 'Réservation annulée avant paiement'),
      updated_at = now()
  where reservation_id = target_reservation_id
    and status in ('pending', 'authorized');

  return query
  select
    cancelled_row.id,
    cancelled_row.status,
    cancelled_row.payment_status,
    requires_refund;
end;
$$;

revoke all on function public.cancel_my_reservation(uuid) from public;
grant execute on function public.cancel_my_reservation(uuid) to authenticated;

-- Expose the two new switches in the existing reservation admin configuration.
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

-- Previous signature from 20260729000400_add_simulated_payment_mode.sql.
drop function if exists public.admin_update_reservation_settings(
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  text
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
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  boolean,
  text
) from public;
grant execute on function public.admin_update_reservation_settings(
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  boolean,
  text
) to authenticated;

create or replace function public.list_my_reservations()
returns table (
  id uuid,
  resource_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  reservation_status public.reservation_status,
  payment_status public.payment_status,
  payment_required boolean,
  amount_cents integer,
  currency text,
  payment_id uuid,
  payment_expires_at timestamptz,
  payment_redirect_url text,
  cancellation_deadline timestamptz,
  can_cancel boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    reservation.id,
    resource.name,
    reservation.starts_at,
    reservation.ends_at,
    reservation.status,
    reservation.payment_status,
    reservation.payment_required,
    reservation.price_cents,
    reservation.currency,
    payment.id,
    payment.expires_at,
    payment.redirect_url,
    reservation.starts_at - make_interval(hours => settings.cancellation_notice_hours),
    reservation.status in ('pending', 'confirmed')
      and reservation.starts_at > now()
      and now() <= reservation.starts_at - make_interval(hours => settings.cancellation_notice_hours),
    reservation.created_at
  from public.reservations as reservation
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  cross join public.reservation_settings as settings
  left join lateral (
    select candidate.id, candidate.expires_at, candidate.redirect_url
    from public.payments as candidate
    where candidate.reservation_id = reservation.id
    order by candidate.created_at desc
    limit 1
  ) as payment on true
  where auth.uid() is not null
    and reservation.user_id = auth.uid()
  order by reservation.starts_at desc;
$$;

revoke all on function public.list_my_reservations() from public;
grant execute on function public.list_my_reservations() to authenticated;

commit;
