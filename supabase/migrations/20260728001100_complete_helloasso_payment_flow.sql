create function public.get_payment_return_status(target_payment_id uuid)
returns table (
  payment_id uuid,
  payment_status public.payment_status,
  reservation_status public.reservation_status,
  amount_cents integer,
  currency text,
  expires_at timestamptz,
  resource_name text,
  starts_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    payment.id,
    payment.status,
    reservation.status,
    payment.amount_cents,
    payment.currency,
    payment.expires_at,
    resource.name,
    reservation.starts_at
  from public.payments as payment
  join public.reservations as reservation on reservation.id = payment.reservation_id
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  where payment.id = target_payment_id;
$$;

revoke all on function public.get_payment_return_status(uuid) from public;
grant execute on function public.get_payment_return_status(uuid) to anon, authenticated;

create function public.expire_abandoned_payments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  with expired as (
    update public.payments
    set status = 'expired',
        failure_reason = coalesce(failure_reason, 'Checkout abandonné après 45 minutes'),
        updated_at = now()
    where status in ('pending', 'authorized')
      and expires_at <= now()
    returning reservation_id
  ), updated_reservations as (
    update public.reservations as reservation
    set payment_status = 'expired',
        status = 'expired',
        updated_at = now()
    where reservation.id in (select reservation_id from expired)
    returning reservation.id
  ), released as (
    update public.calendar_occupations as occupation
    set cancelled_at = coalesce(occupation.cancelled_at, now()),
        updated_at = now()
    where occupation.reservation_id in (select id from updated_reservations)
    returning occupation.id
  )
  select count(*) into affected from updated_reservations;

  return affected;
end;
$$;

revoke all on function public.expire_abandoned_payments() from public;
grant execute on function public.expire_abandoned_payments() to authenticated;

create function public.admin_list_payments(
  status_filter public.payment_status default null,
  range_start timestamptz default null,
  range_end timestamptz default null
)
returns table (
  id uuid,
  reservation_id uuid,
  customer_name text,
  customer_email text,
  resource_name text,
  starts_at timestamptz,
  amount_cents integer,
  currency text,
  status public.payment_status,
  provider_checkout_intent_id text,
  provider_order_id text,
  provider_payment_id text,
  failure_reason text,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz
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
    payment.id,
    reservation.id,
    coalesce(profile.display_name, reservation.guest_name, 'Utilisateur'),
    coalesce(profile.email, reservation.guest_email, ''),
    resource.name,
    reservation.starts_at,
    payment.amount_cents,
    payment.currency,
    payment.status,
    payment.provider_checkout_intent_id,
    payment.provider_order_id,
    payment.provider_payment_id,
    payment.failure_reason,
    payment.paid_at,
    payment.expires_at,
    payment.created_at
  from public.payments as payment
  join public.reservations as reservation on reservation.id = payment.reservation_id
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  left join public.profiles as profile on profile.id = reservation.user_id
  where (status_filter is null or payment.status = status_filter)
    and (range_start is null or payment.created_at >= range_start)
    and (range_end is null or payment.created_at < range_end)
  order by payment.created_at desc;
end;
$$;

revoke all on function public.admin_list_payments(public.payment_status, timestamptz, timestamptz) from public;
grant execute on function public.admin_list_payments(public.payment_status, timestamptz, timestamptz) to authenticated;

create or replace function public.apply_helloasso_payment_event(
  event_key text,
  event_type text,
  event_payload jsonb,
  target_payment_id uuid,
  checkout_intent_id text,
  order_id text,
  provider_payment_id text,
  paid_amount_cents integer,
  provider_state text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments;
  reservation_row public.reservations;
  normalized_status public.payment_status;
begin
  insert into public.payment_events (
    payment_id,
    provider_event_key,
    event_type,
    payload
  ) values (
    target_payment_id,
    event_key,
    event_type,
    event_payload
  ) on conflict (provider, provider_event_key) do nothing;

  if not found then
    return false;
  end if;

  select * into payment_row
  from public.payments
  where id = target_payment_id
  for update;

  if payment_row.id is null then
    raise exception 'Paiement introuvable' using errcode = 'P0002';
  end if;

  normalized_status := case lower(provider_state)
    when 'authorized' then 'paid'::public.payment_status
    when 'paid' then 'paid'::public.payment_status
    when 'refunded' then 'refunded'::public.payment_status
    when 'refused' then 'failed'::public.payment_status
    when 'failed' then 'failed'::public.payment_status
    when 'cancelled' then 'cancelled'::public.payment_status
    else payment_row.status
  end;

  if normalized_status = 'paid' and paid_amount_cents <> payment_row.amount_cents then
    normalized_status := 'failed';
  end if;

  update public.payments as payment
  set status = normalized_status,
      provider_checkout_intent_id = coalesce(checkout_intent_id, payment.provider_checkout_intent_id),
      provider_order_id = coalesce(order_id, payment.provider_order_id),
      provider_payment_id = coalesce(apply_helloasso_payment_event.provider_payment_id, payment.provider_payment_id),
      paid_at = case when normalized_status = 'paid' then coalesce(payment.paid_at, now()) else payment.paid_at end,
      refunded_at = case when normalized_status = 'refunded' then coalesce(payment.refunded_at, now()) else payment.refunded_at end,
      failure_reason = case
        when normalized_status = 'failed' and paid_amount_cents <> payment.amount_cents
          then 'Montant HelloAsso différent du montant attendu'
        else payment.failure_reason
      end,
      updated_at = now()
  where payment.id = target_payment_id
  returning payment.* into payment_row;

  select * into reservation_row
  from public.reservations
  where id = payment_row.reservation_id
  for update;

  update public.reservations
  set payment_status = normalized_status,
      status = case
        when normalized_status = 'paid' then 'confirmed'::public.reservation_status
        when normalized_status in ('failed', 'cancelled', 'expired') then 'expired'::public.reservation_status
        else status
      end,
      updated_at = now()
  where id = reservation_row.id;

  if normalized_status in ('failed', 'cancelled', 'expired') then
    update public.calendar_occupations
    set cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now()
    where reservation_id = reservation_row.id;
  end if;

  update public.payment_events
  set processed_at = now()
  where provider = 'helloasso'
    and provider_event_key = event_key;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    new_data
  ) values (
    reservation_row.id,
    'payment_status_changed:' || normalized_status::text,
    jsonb_build_object('payment_id', payment_row.id, 'event_type', event_type)
  );

  return true;
end;
$$;