begin;

-- Paiement partagé d'une réservation entre quatre comptes Pelote Manager.
-- Le réservant reste propriétaire de la réservation, mais chaque part possède
-- son propre payeur et son propre checkout HelloAsso.

alter table public.reservations
  add column if not exists payment_plan text not null default 'full';

alter table public.reservations
  drop constraint if exists reservations_payment_plan_check;

alter table public.reservations
  add constraint reservations_payment_plan_check
  check (payment_plan in ('full', 'split'));

alter table public.payments
  add column if not exists payer_profile_id uuid
    references public.profiles(id) on delete restrict;

update public.payments as payment
set payer_profile_id = reservation.user_id
from public.reservations as reservation
where reservation.id = payment.reservation_id
  and payment.payer_profile_id is null
  and reservation.user_id is not null;

drop index if exists public.payments_one_open_per_reservation_idx;

create unique index if not exists payments_reservation_payer_unique
on public.payments (reservation_id, payer_profile_id)
where payer_profile_id is not null;

create unique index if not exists payments_one_open_guest_per_reservation_idx
on public.payments (reservation_id)
where payer_profile_id is null
  and status in ('pending', 'authorized');

create index if not exists payments_payer_status_idx
on public.payments (payer_profile_id, status, expires_at)
where payer_profile_id is not null;

drop policy if exists payments_owner_read on public.payments;

create policy payments_owner_read
on public.payments
for select
to authenticated
using (
  payer_profile_id = auth.uid()
  or exists (
    select 1
    from public.reservations as reservation
    where reservation.id = payments.reservation_id
      and reservation.user_id = auth.uid()
  )
);

create table if not exists public.reservation_payment_notification_events (
  payment_id uuid primary key references public.payments(id) on delete cascade,
  communication_id uuid not null unique
    references public.club_communications(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.reservation_payment_notification_events enable row level security;
revoke all on table public.reservation_payment_notification_events
from anon, authenticated;

create or replace function public.search_reservation_payment_players(
  target_resource_id uuid,
  search_text text default ''
)
returns table (
  profile_id uuid,
  display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
  needle text := btrim(coalesce(search_text, ''));
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select resource.club_id
  into target_club_id
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null then
    raise exception 'Terrain introuvable' using errcode = 'P0002';
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
      'Joueur'
    )
  from public.club_members as member
  join public.profiles as profile on profile.member_id = member.id
  where member.club_id = target_club_id
    and member.is_active
    and profile.id <> actor_id
    and (
      needle = ''
      or member.first_name_normalized like '%' || public.normalize_member_identity(needle) || '%'
      or member.last_name_normalized like '%' || public.normalize_member_identity(needle) || '%'
      or lower(coalesce(profile.display_name, '')) like '%' || lower(needle) || '%'
    )
  order by member.last_name_normalized, member.first_name_normalized, profile.id
  limit 30;
end;
$$;

revoke all on function public.search_reservation_payment_players(uuid, text)
from public, anon, authenticated;
grant execute on function public.search_reservation_payment_players(uuid, text)
to authenticated;

create or replace function public.publish_reservation_share_payment_request(
  target_payment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  saved_communication_id uuid;
begin
  select
    payment.id as payment_id,
    payment.amount_cents,
    payment.expires_at,
    payment.payer_profile_id,
    reservation.id as reservation_id,
    reservation.user_id as booker_profile_id,
    reservation.starts_at,
    resource.club_id,
    resource.name as resource_name,
    resource.timezone,
    payer_member.id as payer_member_id,
    payer_profile.email as payer_email,
    coalesce(
      nullif(btrim(booker_profile.display_name), ''),
      nullif(btrim(concat_ws(' ', booker_profile.first_name, booker_profile.last_name)), ''),
      'Un joueur'
    ) as booker_name
  into target
  from public.payments as payment
  join public.reservations as reservation on reservation.id = payment.reservation_id
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  join public.profiles as payer_profile on payer_profile.id = payment.payer_profile_id
  join public.club_members as payer_member
    on payer_member.id = payer_profile.member_id
   and payer_member.club_id = resource.club_id
   and payer_member.is_active
  left join public.profiles as booker_profile on booker_profile.id = reservation.user_id
  where payment.id = target_payment_id
    and reservation.payment_plan = 'split';

  if target.payment_id is null then
    raise exception 'Part de paiement introuvable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.reservation_payment_notification_events as event
    where event.payment_id = target.payment_id
  ) then
    select event.communication_id
    into saved_communication_id
    from public.reservation_payment_notification_events as event
    where event.payment_id = target.payment_id;
    return saved_communication_id;
  end if;

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
    target.club_id,
    'Paiement d’une réservation',
    concat(
      target.booker_name,
      ' vous a ajouté à une réservation de ', target.resource_name,
      ' le ', to_char(target.starts_at at time zone target.timezone, 'DD/MM/YYYY'),
      ' à ', to_char(target.starts_at at time zone target.timezone, 'HH24:MI'),
      '. Votre part est de ',
      trim(to_char(target.amount_cents / 100.0, 'FM999999990D00')),
      ' €. Ouvrez cette notification pour la régler.'
    ),
    'important',
    'published',
    false,
    now(),
    target.expires_at,
    target.booker_profile_id,
    target.booker_profile_id
  )
  returning id into saved_communication_id;

  insert into public.communication_deliveries (
    communication_id,
    club_id,
    club_member_id,
    profile_id_at_publication,
    email_snapshot,
    email_status
  ) values (
    saved_communication_id,
    target.club_id,
    target.payer_member_id,
    target.payer_profile_id,
    nullif(btrim(target.payer_email), ''),
    case
      when nullif(btrim(target.payer_email), '') is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  );

  insert into public.reservation_payment_notification_events (
    payment_id,
    communication_id
  ) values (
    target.payment_id,
    saved_communication_id
  );

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  ) values (
    target.club_id,
    saved_communication_id,
    'published',
    target.booker_profile_id,
    jsonb_build_object(
      'source', 'reservation_split_payment',
      'reservation_id', target.reservation_id,
      'payment_id', target.payment_id,
      'payer_profile_id', target.payer_profile_id
    )
  );

  return saved_communication_id;
end;
$$;

revoke all on function public.publish_reservation_share_payment_request(uuid)
from public, anon, authenticated;

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
      payment_plan = 'full',
      updated_at = now(),
      updated_by = auth.uid()
  where id = created_reservation.id
  returning * into created_reservation;

  insert into public.payments (
    reservation_id,
    payer_profile_id,
    amount_cents,
    currency,
    metadata
  ) values (
    created_reservation.id,
    auth.uid(),
    created_reservation.price_cents,
    created_reservation.currency,
    jsonb_build_object(
      'reservation_id', created_reservation.id,
      'payment_plan', 'full'
    )
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
    jsonb_build_object('payment_id', created_payment.id, 'payment_plan', 'full')
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

create or replace function public.reserve_for_split_payment(
  target_resource_id uuid,
  target_starts_at timestamptz,
  partner_profile_ids uuid[]
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
  actor_id uuid := auth.uid();
  target_club_id uuid;
  eligible_count integer;
  created_reservation public.reservations;
  created_payment public.payments;
  partner_id uuid;
  partner_payment public.payments;
  common_expires_at timestamptz := now() + interval '45 minutes';
  partner_amount integer;
  actor_amount integer;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  if not (select online_payment_enabled from public.reservation_settings where id) then
    raise exception 'Le paiement en ligne est désactivé' using errcode = 'P0001';
  end if;

  if coalesce(array_length(partner_profile_ids, 1), 0) <> 3
    or (
      select count(distinct candidate)
      from unnest(partner_profile_ids) as candidate
    ) <> 3
    or actor_id = any(partner_profile_ids)
  then
    raise exception 'Sélectionnez exactement trois autres joueurs'
      using errcode = '22023';
  end if;

  select resource.club_id
  into target_club_id
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null then
    raise exception 'Terrain introuvable' using errcode = 'P0002';
  end if;

  select count(*)
  into eligible_count
  from public.profiles as profile
  join public.club_members as member
    on member.id = profile.member_id
   and member.club_id = target_club_id
   and member.is_active
  where profile.id = any(partner_profile_ids);

  if eligible_count <> 3 then
    raise exception 'Les joueurs sélectionnés doivent posséder un compte Pelote Manager actif dans ce club'
      using errcode = '22023';
  end if;

  created_reservation := public.create_reservation_record(
    target_resource_id,
    target_starts_at,
    null,
    null,
    null
  );

  update public.reservations
  set status = 'pending',
      payment_required = true,
      payment_status = 'pending',
      payment_plan = 'split',
      updated_at = now(),
      updated_by = actor_id
  where id = created_reservation.id
  returning * into created_reservation;

  partner_amount := created_reservation.price_cents / 4;
  actor_amount := created_reservation.price_cents - (partner_amount * 3);

  insert into public.payments (
    reservation_id,
    payer_profile_id,
    amount_cents,
    currency,
    expires_at,
    metadata
  ) values (
    created_reservation.id,
    actor_id,
    actor_amount,
    created_reservation.currency,
    common_expires_at,
    jsonb_build_object(
      'reservation_id', created_reservation.id,
      'payment_plan', 'split',
      'share', 1,
      'share_count', 4
    )
  ) returning * into created_payment;

  for partner_id in
    select candidate
    from unnest(partner_profile_ids) as candidate
  loop
    insert into public.payments (
      reservation_id,
      payer_profile_id,
      amount_cents,
      currency,
      expires_at,
      metadata
    ) values (
      created_reservation.id,
      partner_id,
      partner_amount,
      created_reservation.currency,
      common_expires_at,
      jsonb_build_object(
        'reservation_id', created_reservation.id,
        'payment_plan', 'split',
        'share_count', 4
      )
    ) returning * into partner_payment;

    perform public.publish_reservation_share_payment_request(partner_payment.id);
  end loop;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    new_data
  ) values (
    created_reservation.id,
    'split_payment_started',
    actor_id,
    jsonb_build_object(
      'owner_payment_id', created_payment.id,
      'partner_profile_ids', to_jsonb(partner_profile_ids),
      'share_count', 4,
      'expires_at', common_expires_at
    )
  );

  return query select
    created_reservation.id,
    created_payment.id,
    created_payment.amount_cents,
    created_payment.currency,
    created_payment.expires_at;
end;
$$;

revoke all on function public.reserve_for_split_payment(uuid, timestamptz, uuid[])
from public, anon, authenticated;
grant execute on function public.reserve_for_split_payment(uuid, timestamptz, uuid[])
to authenticated;

drop function if exists public.get_payment_for_checkout(uuid);

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
  expires_at timestamptz,
  payment_plan text
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
    coalesce(
      nullif(btrim(payer_profile.display_name), ''),
      reservation.guest_name,
      'Utilisateur'
    ),
    coalesce(payer_profile.email, reservation.guest_email, ''),
    reservation.starts_at,
    resource.name,
    payment.expires_at,
    reservation.payment_plan
  from public.payments as payment
  join public.reservations as reservation on reservation.id = payment.reservation_id
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  left join public.profiles as payer_profile
    on payer_profile.id = coalesce(payment.payer_profile_id, reservation.user_id)
  where payment.id = target_payment_id
    and payment.status = 'pending'
    and payment.expires_at > now()
    and reservation.status = 'pending'
    and (
      payment.payer_profile_id = auth.uid()
      or (
        payment.payer_profile_id is null
        and (reservation.user_id = auth.uid() or reservation.user_id is null)
      )
    );
end;
$$;

revoke all on function public.get_payment_for_checkout(uuid) from public;
grant execute on function public.get_payment_for_checkout(uuid) to anon, authenticated;

create or replace function public.prepare_my_reservation_payment(target_payment_id uuid)
returns table (
  payment_id uuid,
  payment_status public.payment_status,
  redirect_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  payment_row public.payments;
  reservation_row public.reservations;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select payment.*
  into payment_row
  from public.payments as payment
  where payment.id = target_payment_id
  for update;

  if payment_row.id is null
    or payment_row.payer_profile_id is distinct from actor_id
  then
    raise exception 'Part de paiement introuvable' using errcode = 'P0002';
  end if;

  select reservation.*
  into reservation_row
  from public.reservations as reservation
  where reservation.id = payment_row.reservation_id
  for update;

  if payment_row.status = 'paid' then
    return query select payment_row.id, payment_row.status, payment_row.redirect_url;
    return;
  end if;

  if reservation_row.status <> 'pending'
    or payment_row.expires_at <= now()
    or payment_row.status = 'expired'
  then
    raise exception 'Cette demande de paiement a expiré' using errcode = 'P0001';
  end if;

  if payment_row.status in ('failed', 'cancelled') then
    if reservation_row.payment_plan <> 'split' then
      raise exception 'Ce paiement ne peut plus être relancé' using errcode = 'P0001';
    end if;

    update public.payments
    set status = 'pending',
        provider_checkout_intent_id = null,
        provider_order_id = null,
        provider_payment_id = null,
        redirect_url = null,
        failure_reason = null,
        paid_at = null,
        updated_at = now()
    where id = payment_row.id
    returning * into payment_row;
  end if;

  return query select payment_row.id, payment_row.status, payment_row.redirect_url;
end;
$$;

revoke all on function public.prepare_my_reservation_payment(uuid)
from public, anon, authenticated;
grant execute on function public.prepare_my_reservation_payment(uuid)
to authenticated;

create or replace function public.get_my_reservation_payment_share(target_payment_id uuid)
returns table (
  payment_id uuid,
  payment_status public.payment_status,
  reservation_status public.reservation_status,
  amount_cents integer,
  currency text,
  expires_at timestamptz,
  resource_name text,
  starts_at timestamptz,
  booker_name text,
  paid_count integer,
  payment_count integer
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
    reservation.starts_at,
    coalesce(
      nullif(btrim(booker.display_name), ''),
      nullif(btrim(concat_ws(' ', booker.first_name, booker.last_name)), ''),
      'Utilisateur'
    ),
    (
      select count(*)::integer
      from public.payments as sibling
      where sibling.reservation_id = reservation.id
        and sibling.status = 'paid'
    ),
    (
      select count(*)::integer
      from public.payments as sibling
      where sibling.reservation_id = reservation.id
    )
  from public.payments as payment
  join public.reservations as reservation on reservation.id = payment.reservation_id
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  left join public.profiles as booker on booker.id = reservation.user_id
  where payment.id = target_payment_id
    and payment.payer_profile_id = auth.uid()
    and reservation.payment_plan = 'split';
$$;

revoke all on function public.get_my_reservation_payment_share(uuid)
from public, anon, authenticated;
grant execute on function public.get_my_reservation_payment_share(uuid)
to authenticated;

create or replace function public.reconcile_reservation_payment_state(
  target_reservation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_row public.reservations;
  payment_count integer;
  paid_count integer;
  has_terminal boolean;
  has_refund boolean;
  first_expiry timestamptz;
begin
  select reservation.*
  into reservation_row
  from public.reservations as reservation
  where reservation.id = target_reservation_id
  for update;

  if reservation_row.id is null or not reservation_row.payment_required then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (where payment.status = 'paid')::integer,
    bool_or(payment.status in ('failed', 'cancelled', 'expired')),
    bool_or(payment.status = 'refunded'),
    min(payment.expires_at)
  into payment_count, paid_count, has_terminal, has_refund, first_expiry
  from public.payments as payment
  where payment.reservation_id = reservation_row.id;

  if payment_count > 0 and paid_count = payment_count then
    update public.reservations
    set payment_status = 'paid',
        status = case
          when status = 'pending' then 'confirmed'::public.reservation_status
          else status
        end,
        updated_at = now()
    where id = reservation_row.id;

    update public.club_communications as communication
    set status = 'archived',
        archived_at = coalesce(communication.archived_at, now()),
        updated_at = now()
    where communication.id in (
      select event.communication_id
      from public.reservation_payment_notification_events as event
      join public.payments as payment on payment.id = event.payment_id
      where payment.reservation_id = reservation_row.id
    )
      and communication.status = 'published';

    return;
  end if;

  if has_refund and reservation_row.status = 'confirmed' then
    update public.reservations
    set payment_status = 'refunded',
        updated_at = now()
    where id = reservation_row.id;
    return;
  end if;

  if reservation_row.status <> 'pending' then
    return;
  end if;

  if (
      reservation_row.payment_plan = 'full'
      and coalesce(has_terminal, false)
    )
    or (
      reservation_row.payment_plan = 'split'
      and first_expiry is not null
      and first_expiry <= now()
    )
  then
    if reservation_row.payment_plan = 'split' then
      update public.payments
      set status = 'expired',
          failure_reason = coalesce(failure_reason, 'Délai de paiement partagé dépassé'),
          updated_at = now()
      where reservation_id = reservation_row.id
        and status <> 'paid';
    end if;

    update public.reservations
    set payment_status = 'expired',
        status = 'expired',
        updated_at = now()
    where id = reservation_row.id;

    update public.calendar_occupations
    set cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now()
    where reservation_id = reservation_row.id
      and cancelled_at is null;

    update public.club_communications as communication
    set status = 'archived',
        archived_at = coalesce(communication.archived_at, now()),
        updated_at = now()
    where communication.id in (
      select event.communication_id
      from public.reservation_payment_notification_events as event
      join public.payments as payment on payment.id = event.payment_id
      where payment.reservation_id = reservation_row.id
    )
      and communication.status = 'published';
  else
    update public.reservations
    set payment_status = 'pending',
        updated_at = now()
    where id = reservation_row.id;
  end if;
end;
$$;

revoke all on function public.reconcile_reservation_payment_state(uuid)
from public, anon, authenticated;

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

  select payment.*
  into payment_row
  from public.payments as payment
  where payment.id = target_payment_id
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
      paid_at = case
        when normalized_status = 'paid' then coalesce(payment.paid_at, now())
        else payment.paid_at
      end,
      refunded_at = case
        when normalized_status = 'refunded' then coalesce(payment.refunded_at, now())
        else payment.refunded_at
      end,
      failure_reason = case
        when normalized_status = 'failed' and paid_amount_cents <> payment.amount_cents
          then 'Montant HelloAsso différent du montant attendu'
        else payment.failure_reason
      end,
      updated_at = now()
  where payment.id = target_payment_id
  returning payment.* into payment_row;

  if normalized_status = 'paid' then
    update public.club_communications as communication
    set status = 'archived',
        archived_at = coalesce(communication.archived_at, now()),
        updated_at = now()
    where communication.id = (
      select event.communication_id
      from public.reservation_payment_notification_events as event
      where event.payment_id = payment_row.id
    )
      and communication.status = 'published';
  end if;

  perform public.reconcile_reservation_payment_state(payment_row.reservation_id);

  update public.payment_events
  set processed_at = now()
  where provider = 'helloasso'
    and provider_event_key = event_key;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    new_data
  ) values (
    payment_row.reservation_id,
    'payment_status_changed:' || normalized_status::text,
    jsonb_build_object(
      'payment_id', payment_row.id,
      'payer_profile_id', payment_row.payer_profile_id,
      'event_type', event_type
    )
  );

  return true;
end;
$$;

create or replace function public.simulate_payment(
  target_payment_id uuid,
  simulated_outcome text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  payment_row public.payments;
  final_status public.payment_status;
begin
  if (select payment_mode from public.reservation_settings where id) <> 'test' then
    raise exception 'Le paiement simulé est désactivé' using errcode = '42501';
  end if;

  if simulated_outcome not in ('paid', 'failed', 'cancelled') then
    raise exception 'Résultat de simulation invalide' using errcode = '22023';
  end if;

  select payment.*
  into payment_row
  from public.payments as payment
  join public.reservations as reservation on reservation.id = payment.reservation_id
  where payment.id = target_payment_id
    and payment.status = 'pending'
    and payment.provider_checkout_intent_id is null
    and (
      payment.payer_profile_id = actor_id
      or (
        payment.payer_profile_id is null
        and (reservation.user_id = actor_id or reservation.user_id is null)
      )
    )
  for update of payment;

  if payment_row.id is null then
    raise exception 'Paiement simulable introuvable' using errcode = 'P0002';
  end if;

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
  where id = payment_row.id
  returning * into payment_row;

  if final_status = 'paid' then
    update public.club_communications as communication
    set status = 'archived',
        archived_at = coalesce(communication.archived_at, now()),
        updated_at = now()
    where communication.id = (
      select event.communication_id
      from public.reservation_payment_notification_events as event
      where event.payment_id = payment_row.id
    )
      and communication.status = 'published';
  end if;

  perform public.reconcile_reservation_payment_state(payment_row.reservation_id);

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    new_data
  ) values (
    payment_row.reservation_id,
    'payment_simulated:' || simulated_outcome,
    actor_id,
    jsonb_build_object(
      'payment_id', payment_row.id,
      'payer_profile_id', payment_row.payer_profile_id
    )
  );

  return simulated_outcome;
end;
$$;

revoke all on function public.simulate_payment(uuid, text) from public;
grant execute on function public.simulate_payment(uuid, text) to anon, authenticated;

create or replace function public.expire_abandoned_payments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due record;
  affected integer := 0;
begin
  for due in
    select distinct reservation.id as reservation_id
    from public.reservations as reservation
    join public.payments as payment on payment.reservation_id = reservation.id
    where reservation.status = 'pending'
      and reservation.payment_required
      and payment.expires_at <= now()
      and payment.status <> 'paid'
  loop
    perform public.reconcile_reservation_payment_state(due.reservation_id);

    if exists (
      select 1
      from public.reservations as reservation
      where reservation.id = due.reservation_id
        and reservation.status = 'expired'
    ) then
      affected := affected + 1;
    end if;
  end loop;

  return affected;
end;
$$;

revoke all on function public.expire_abandoned_payments() from public;
grant execute on function public.expire_abandoned_payments() to authenticated;

create or replace function public.admin_list_payments(
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
    coalesce(
      nullif(btrim(payer.display_name), ''),
      reservation.guest_name,
      'Utilisateur'
    ),
    coalesce(payer.email, reservation.guest_email, ''),
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
  left join public.profiles as payer
    on payer.id = coalesce(payment.payer_profile_id, reservation.user_id)
  where (status_filter is null or payment.status = status_filter)
    and (range_start is null or payment.created_at >= range_start)
    and (range_end is null or payment.created_at < range_end)
  order by payment.created_at desc;
end;
$$;

create or replace function public.list_my_notifications_v2()
returns table (
  delivery_id uuid,
  communication_id uuid,
  title text,
  body text,
  priority public.communication_priority,
  published_at timestamptz,
  expires_at timestamptz,
  read_at timestamptz,
  is_active boolean,
  action_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    deliveries.id,
    communications.id,
    communications.title,
    communications.body,
    communications.priority,
    communications.published_at,
    communications.expires_at,
    deliveries.read_at,
    communications.status = 'published'
      and (communications.expires_at is null or communications.expires_at > now()),
    case
      when payment_request.payment_id is not null then
        format('/reservations/paiement-part?paymentId=%s', payment_request.payment_id)
      when admin_event.tournament_id is not null then '/admin/tournois'
      when match_event.match_id is not null then
        format('/mon-espace/tournois?match=%s', match_event.match_id)
      when tournament_event.event_kind = 'planning_published' then '/mon-espace/tournois'
      when tournament_event.tournament_id is not null then
        format('/tournois/%s#inscription', tournament_event.tournament_id)
      else null
    end
  from public.communication_deliveries as deliveries
  join public.club_communications as communications
    on communications.id = deliveries.communication_id
   and communications.club_id = deliveries.club_id
  left join public.reservation_payment_notification_events as payment_request
    on payment_request.communication_id = communications.id
  left join public.tournament_notification_events as tournament_event
    on tournament_event.communication_id = communications.id
  left join public.tournament_match_reminder_events as match_event
    on match_event.communication_id = communications.id
  left join public.tournament_admin_reminder_events as admin_event
    on admin_event.communication_id = communications.id
  where (
      deliveries.profile_id_at_publication = auth.uid()
      or exists (
        select 1
        from public.profiles as profile
        join public.club_members as member on member.id = profile.member_id
        where profile.id = auth.uid()
          and member.id = deliveries.club_member_id
          and member.club_id = deliveries.club_id
          and member.is_active
      )
    )
    and communications.status in ('published', 'archived')
  order by communications.published_at desc nulls last, communications.id desc;
$$;

revoke all on function public.list_my_notifications_v2()
from public, anon, authenticated;
grant execute on function public.list_my_notifications_v2()
to authenticated;

commit;
