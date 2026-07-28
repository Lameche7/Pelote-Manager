create type public.payment_provider as enum ('helloasso');
create type public.payment_status as enum (
  'pending',
  'authorized',
  'paid',
  'failed',
  'cancelled',
  'refunded',
  'expired'
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete restrict,
  provider public.payment_provider not null default 'helloasso',
  status public.payment_status not null default 'pending',
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  provider_checkout_intent_id text,
  provider_order_id text,
  provider_payment_id text,
  redirect_url text,
  metadata jsonb not null default '{}'::jsonb,
  failure_reason text,
  paid_at timestamptz,
  refunded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '45 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_provider_checkout_unique unique (provider, provider_checkout_intent_id),
  constraint payments_provider_payment_unique unique (provider, provider_payment_id)
);

create unique index payments_one_open_per_reservation_idx
on public.payments (reservation_id)
where status in ('pending', 'authorized');

create index payments_reservation_created_at_idx
on public.payments (reservation_id, created_at desc);

create table public.payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid references public.payments (id),
  provider public.payment_provider not null default 'helloasso',
  provider_event_key text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  constraint payment_events_provider_key_unique unique (provider, provider_event_key)
);

alter table public.reservations
add column payment_status public.payment_status not null default 'pending';

alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

create policy payments_owner_read
on public.payments
for select
to authenticated
using (
  exists (
    select 1
    from public.reservations
    where reservations.id = payments.reservation_id
      and reservations.user_id = auth.uid()
  )
);

create policy payments_admin_read
on public.payments
for select
to authenticated
using (public.is_profile_admin());

create policy payment_events_admin_read
on public.payment_events
for select
to authenticated
using (public.is_profile_admin());

create function public.reserve_for_payment(
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
  created_reservation := public.create_reservation(
    target_resource_id,
    target_starts_at,
    guest_name,
    guest_email,
    guest_phone
  );

  update public.reservations
  set status = 'pending',
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

create function public.get_payment_for_checkout(target_payment_id uuid)
returns table (
  payment_id uuid,
  reservation_id uuid,
  amount_cents integer,
  currency text,
  item_name text,
  payer_name text,
  payer_email text,
  starts_at timestamptz,
  resource_name text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    payment.id,
    reservation.id,
    payment.amount_cents,
    payment.currency,
    'Réservation ' || resource.name,
    coalesce(profile.display_name, reservation.guest_name, 'Utilisateur'),
    coalesce(profile.email, reservation.guest_email, ''),
    reservation.starts_at,
    resource.name,
    payment.expires_at
  from public.payments as payment
  join public.reservations as reservation on reservation.id = payment.reservation_id
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  left join public.profiles as profile on profile.id = reservation.user_id
  where payment.id = target_payment_id
    and payment.status = 'pending'
    and payment.expires_at > now()
    and (
      reservation.user_id = auth.uid()
      or reservation.user_id is null
    );
end;
$$;

create function public.register_helloasso_checkout(
  target_payment_id uuid,
  checkout_intent_id text,
  checkout_redirect_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
  set provider_checkout_intent_id = checkout_intent_id,
      redirect_url = checkout_redirect_url,
      updated_at = now()
  where id = target_payment_id
    and status = 'pending';

  if not found then
    raise exception 'Paiement introuvable ou déjà traité' using errcode = 'P0002';
  end if;
end;
$$;

create function public.apply_helloasso_payment_event(
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

  update public.payments
  set status = normalized_status,
      provider_checkout_intent_id = coalesce(checkout_intent_id, provider_checkout_intent_id),
      provider_order_id = coalesce(order_id, provider_order_id),
      provider_payment_id = coalesce(provider_payment_id, provider_payment_id),
      paid_at = case when normalized_status = 'paid' then coalesce(paid_at, now()) else paid_at end,
      refunded_at = case when normalized_status = 'refunded' then coalesce(refunded_at, now()) else refunded_at end,
      failure_reason = case
        when normalized_status = 'failed' and paid_amount_cents <> payment_row.amount_cents
          then 'Montant HelloAsso différent du montant attendu'
        else failure_reason
      end,
      updated_at = now()
  where id = target_payment_id
  returning * into payment_row;

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

revoke all on function public.reserve_for_payment(uuid, timestamptz, text, text, text) from public;
revoke all on function public.get_payment_for_checkout(uuid) from public;
revoke all on function public.register_helloasso_checkout(uuid, text, text) from public;
revoke all on function public.apply_helloasso_payment_event(text, text, jsonb, uuid, text, text, text, integer, text) from public;

grant execute on function public.reserve_for_payment(uuid, timestamptz, text, text, text) to anon, authenticated;
grant execute on function public.get_payment_for_checkout(uuid) to anon, authenticated;
