alter table public.reservation_settings
add column payment_mode text not null default 'test'
  check (payment_mode in ('test', 'helloasso'));

create or replace function public.get_payment_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select settings.payment_mode
  from public.reservation_settings as settings
  where settings.id;
$$;

revoke all on function public.get_payment_mode() from public;
grant execute on function public.get_payment_mode() to anon, authenticated;

drop function public.admin_get_reservation_settings();

create function public.admin_get_reservation_settings()
returns table (
  licensee_advance_hours integer,
  public_advance_hours integer,
  licensee_price_cents integer,
  public_price_cents integer,
  default_duration_minutes integer,
  booking_step_minutes integer,
  minimum_notice_minutes integer,
  licensee_max_active_reservations integer,
  public_max_active_reservations integer,
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
    settings.licensee_max_active_reservations,
    settings.public_max_active_reservations,
    settings.payment_mode
  from public.reservation_settings as settings
  where settings.id;
end;
$$;

drop function public.admin_update_reservation_settings(integer, integer, integer, integer, integer, integer, integer, integer, integer);

create function public.admin_update_reservation_settings(
  new_licensee_advance_hours integer,
  new_public_advance_hours integer,
  new_licensee_price_cents integer,
  new_public_price_cents integer,
  new_default_duration_minutes integer,
  new_booking_step_minutes integer,
  new_minimum_notice_minutes integer,
  new_licensee_max_active_reservations integer,
  new_public_max_active_reservations integer,
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
      licensee_max_active_reservations = new_licensee_max_active_reservations,
      public_max_active_reservations = new_public_max_active_reservations,
      payment_mode = new_payment_mode,
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

create function public.simulate_payment(
  target_payment_id uuid,
  simulated_outcome text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments;
  reservation_row public.reservations;
  final_status public.payment_status;
begin
  if (select payment_mode from public.reservation_settings where id) <> 'test' then
    raise exception 'Le paiement simulé est désactivé' using errcode = '42501';
  end if;

  if simulated_outcome not in ('paid', 'failed', 'cancelled') then
    raise exception 'Résultat de simulation invalide' using errcode = '22023';
  end if;

  select * into payment_row
  from public.payments
  where id = target_payment_id
    and status = 'pending'
    and provider_checkout_intent_id is null
  for update;

  if payment_row.id is null then
    raise exception 'Paiement simulable introuvable' using errcode = 'P0002';
  end if;

  select * into reservation_row
  from public.reservations
  where id = payment_row.reservation_id
  for update;

  final_status := simulated_outcome::public.payment_status;

  update public.payments
  set status = final_status,
      paid_at = case when final_status = 'paid' then now() else paid_at end,
      failure_reason = case
        when final_status = 'failed' then 'Paiement refusé en mode test'
        when final_status = 'cancelled' then 'Paiement annulé en mode test'
        else null
      end,
      metadata = metadata || jsonb_build_object('simulated', true, 'outcome', simulated_outcome),
      updated_at = now()
  where id = payment_row.id;

  update public.reservations
  set payment_status = final_status,
      status = case
        when final_status = 'paid' then 'confirmed'::public.reservation_status
        else 'expired'::public.reservation_status
      end,
      updated_at = now()
  where id = reservation_row.id;

  if final_status <> 'paid' then
    update public.calendar_occupations
    set cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now()
    where reservation_id = reservation_row.id;
  end if;

  insert into public.reservation_audit_log (
    reservation_id, action, actor_id, new_data
  ) values (
    reservation_row.id,
    'payment_simulated:' || simulated_outcome,
    auth.uid(),
    jsonb_build_object('payment_id', payment_row.id)
  );

  return simulated_outcome;
end;
$$;

revoke all on function public.simulate_payment(uuid, text) from public;
grant execute on function public.simulate_payment(uuid, text) to anon, authenticated;
