alter table public.reservation_settings
add column licensee_max_active_reservations integer not null default 3
  check (licensee_max_active_reservations > 0),
add column public_max_active_reservations integer not null default 2
  check (public_max_active_reservations > 0);

create function public.get_reservation_terms(
  target_user_id uuid,
  target_starts_at timestamptz
)
returns table (
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
  settings public.reservation_settings%rowtype;
  active_licensee boolean;
begin
  select *
  into strict settings
  from public.reservation_settings
  where id;

  active_licensee := target_user_id is not null
    and public.is_active_licensee(
      target_user_id,
      (target_starts_at at time zone 'Europe/Paris')::date
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

revoke all on function public.get_reservation_terms(uuid, timestamptz) from public;
grant execute on function public.get_reservation_terms(uuid, timestamptz)
to anon, authenticated;

create function public.assert_reservation_slot_allowed(
  target_resource_id uuid,
  target_user_id uuid,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  excluded_reservation_id uuid default null
)
returns table (
  customer_type public.reservation_customer_type,
  price_cents integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_active boolean;
  settings public.reservation_settings%rowtype;
  terms record;
  active_count integer;
begin
  if target_ends_at <= target_starts_at then
    raise exception 'La fin du créneau doit être postérieure au début'
      using errcode = '22007';
  end if;

  select is_active
  into resource_active
  from public.reservable_resources
  where id = target_resource_id;

  if resource_active is distinct from true then
    raise exception 'La ressource demandée est indisponible'
      using errcode = 'P0001';
  end if;

  select *
  into strict settings
  from public.reservation_settings
  where id;

  if extract(epoch from (target_ends_at - target_starts_at))::integer / 60
    <> settings.default_duration_minutes then
    raise exception 'La durée du créneau ne respecte pas la durée configurée'
      using errcode = 'P0001';
  end if;

  select *
  into strict terms
  from public.get_reservation_terms(target_user_id, target_starts_at);

  if now() < target_starts_at - make_interval(hours => terms.advance_hours) then
    raise exception 'Ce créneau n''est pas encore ouvert à la réservation'
      using errcode = 'P0001';
  end if;

  if now() + make_interval(mins => settings.minimum_notice_minutes)
    >= target_starts_at then
    raise exception 'Le délai minimum avant réservation n''est pas respecté'
      using errcode = 'P0001';
  end if;

  if target_user_id is not null then
    select count(*)
    into active_count
    from public.reservations
    where user_id = target_user_id
      and id is distinct from excluded_reservation_id
      and status in ('pending', 'confirmed')
      and ends_at > now();

    if active_count >= terms.max_active_reservations then
      raise exception 'Le nombre maximal de réservations actives est atteint'
        using errcode = 'P0001';
    end if;
  end if;

  if exists (
    select 1
    from public.calendar_occupations
    where resource_id = target_resource_id
      and cancelled_at is null
      and reservation_id is distinct from excluded_reservation_id
      and tstzrange(starts_at, ends_at, '[)')
        && tstzrange(target_starts_at, target_ends_at, '[)')
  ) then
    raise exception 'Ce créneau est déjà occupé'
      using errcode = '23P01';
  end if;

  return query select terms.customer_type, terms.price_cents;
end;
$$;

revoke all on function public.assert_reservation_slot_allowed(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  uuid
) from public;

create function public.create_reservation(
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

create function public.modify_reservation(
  target_reservation_id uuid,
  target_resource_id uuid,
  target_starts_at timestamptz
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_reservation public.reservations;
  settings public.reservation_settings%rowtype;
  target_ends_at timestamptz;
  terms record;
  changed_reservation public.reservations;
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
    and not public.is_profile_admin() then
    raise exception 'Modification interdite' using errcode = '42501';
  end if;

  if existing_reservation.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut plus être modifiée'
      using errcode = 'P0001';
  end if;

  select *
  into strict settings
  from public.reservation_settings
  where id;

  target_ends_at := target_starts_at
    + make_interval(mins => settings.default_duration_minutes);

  select *
  into strict terms
  from public.assert_reservation_slot_allowed(
    target_resource_id,
    existing_reservation.user_id,
    target_starts_at,
    target_ends_at,
    target_reservation_id
  );

  update public.reservations
  set resource_id = target_resource_id,
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      customer_type = terms.customer_type,
      price_cents = terms.price_cents,
      updated_at = now(),
      updated_by = actor_id
  where id = target_reservation_id
  returning * into changed_reservation;

  update public.calendar_occupations
  set resource_id = target_resource_id,
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      updated_at = now(),
      updated_by = actor_id
  where reservation_id = target_reservation_id;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    target_reservation_id,
    'modified',
    actor_id,
    to_jsonb(existing_reservation),
    to_jsonb(changed_reservation)
  );

  return changed_reservation;
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d''être réservé par une autre personne'
      using errcode = '23P01';
end;
$$;

revoke all on function public.modify_reservation(uuid, uuid, timestamptz)
from public;
grant execute on function public.modify_reservation(uuid, uuid, timestamptz)
to authenticated;

create function public.cancel_reservation(
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
    and not public.is_profile_admin() then
    raise exception 'Annulation interdite' using errcode = '42501';
  end if;

  if existing_reservation.status = 'cancelled' then
    return existing_reservation;
  end if;

  if existing_reservation.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut plus être annulée'
      using errcode = 'P0001';
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

  return cancelled_reservation;
end;
$$;

revoke all on function public.cancel_reservation(uuid, text) from public;
grant execute on function public.cancel_reservation(uuid, text)
to authenticated;

create policy reservation_settings_public_read
on public.reservation_settings
for select
to anon, authenticated
using (true);

create policy reservations_admin_read
on public.reservations
for select
to authenticated
using (public.is_profile_admin());

create policy calendar_occupations_admin_all
on public.calendar_occupations
for all
to authenticated
using (public.is_profile_admin())
with check (public.is_profile_admin());
