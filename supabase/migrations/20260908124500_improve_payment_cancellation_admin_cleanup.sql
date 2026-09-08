begin;

-- Un paiement encore ouvert ne doit pas enfermer le réservant dans une
-- réservation qu'il ne peut plus annuler à cause du délai habituel du club.
-- Tant que la réservation n'a pas commencé, le réservant peut abandonner une
-- réservation en attente de paiement. Une réservation déjà payée conserve le
-- délai d'annulation configuré.
drop function if exists public.list_my_reservations();

create function public.list_my_reservations()
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
      and (
        now() <= reservation.starts_at - make_interval(hours => settings.cancellation_notice_hours)
        or (
          reservation.status = 'pending'
          and reservation.payment_required
          and exists (
            select 1
            from public.payments as open_payment
            where open_payment.reservation_id = reservation.id
              and open_payment.status in ('pending', 'authorized')
          )
        )
      ),
    reservation.created_at
  from public.reservations as reservation
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  cross join public.reservation_settings as settings
  left join lateral (
    select candidate.id, candidate.expires_at, candidate.redirect_url
    from public.payments as candidate
    where candidate.reservation_id = reservation.id
      and (
        candidate.payer_profile_id = auth.uid()
        or candidate.payer_profile_id is null
      )
    order by
      case when candidate.status in ('pending', 'authorized') then 0 else 1 end,
      candidate.created_at desc
    limit 1
  ) as payment on true
  where auth.uid() is not null
    and reservation.user_id = auth.uid()
  order by reservation.starts_at desc;
$$;

revoke all on function public.list_my_reservations() from public;
grant execute on function public.list_my_reservations() to authenticated;

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
  actor_id uuid := auth.uid();
  reservation_row public.reservations;
  cancelled_row public.reservations;
  notice_hours integer;
  has_open_payment boolean := false;
  requires_refund boolean := false;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select reservation.*
  into reservation_row
  from public.reservations as reservation
  where reservation.id = target_reservation_id
    and reservation.user_id = actor_id
  for update;

  if reservation_row.id is null then
    raise exception 'Réservation introuvable' using errcode = 'P0002';
  end if;

  if reservation_row.status = 'cancelled' then
    return query
    select
      reservation_row.id,
      reservation_row.status,
      reservation_row.payment_status,
      exists (
        select 1
        from public.payments as payment
        where payment.reservation_id = reservation_row.id
          and payment.status = 'paid'
      );
    return;
  end if;

  if reservation_row.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut plus être annulée'
      using errcode = '22023';
  end if;

  if reservation_row.starts_at <= now() then
    raise exception 'La réservation a déjà commencé'
      using errcode = '22023';
  end if;

  select settings.cancellation_notice_hours
  into notice_hours
  from public.reservation_settings as settings
  where settings.id = true;

  notice_hours := coalesce(notice_hours, 8);

  select exists (
    select 1
    from public.payments as payment
    where payment.reservation_id = reservation_row.id
      and payment.status in ('pending', 'authorized')
  )
  into has_open_payment;

  if now() > reservation_row.starts_at - make_interval(hours => notice_hours)
    and not (
      reservation_row.status = 'pending'
      and reservation_row.payment_required
      and has_open_payment
    )
  then
    raise exception 'Le délai d’annulation en ligne est dépassé'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.payments as payment
    where payment.reservation_id = reservation_row.id
      and payment.status = 'paid'
  )
  into requires_refund;

  update public.reservations as reservation
  set status = 'cancelled',
      payment_status = case
        when requires_refund then reservation.payment_status
        else 'cancelled'::public.payment_status
      end,
      cancelled_at = now(),
      cancelled_by = actor_id,
      cancellation_reason = 'Annulation en ligne par le réservant',
      updated_at = now(),
      updated_by = actor_id
  where reservation.id = target_reservation_id
  returning reservation.* into cancelled_row;

  update public.calendar_occupations as occupation
  set cancelled_at = coalesce(occupation.cancelled_at, now()),
      updated_at = now(),
      updated_by = actor_id
  where occupation.reservation_id = target_reservation_id
    and occupation.cancelled_at is null;

  update public.payments as payment
  set status = 'cancelled',
      failure_reason = coalesce(payment.failure_reason, 'Réservation annulée avant paiement'),
      updated_at = now()
  where payment.reservation_id = target_reservation_id
    and payment.status in ('pending', 'authorized');

  update public.club_communications as communication
  set status = 'archived',
      archived_at = coalesce(communication.archived_at, now()),
      updated_at = now()
  where communication.id in (
    select event.communication_id
    from public.reservation_payment_notification_events as event
    join public.payments as payment on payment.id = event.payment_id
    where payment.reservation_id = target_reservation_id
  )
    and communication.status = 'published';

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    target_reservation_id,
    'cancelled_by_customer',
    actor_id,
    to_jsonb(reservation_row),
    to_jsonb(cancelled_row)
  );

  begin
    perform public.publish_released_reservation_slot_notification(
      target_reservation_id,
      actor_id
    );
  exception when others then
    raise warning 'Notification de créneau libéré non publiée pour la réservation %: %',
      target_reservation_id,
      sqlerrm;
  end;

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

-- L'administrateur peut annuler la réservation depuis une ligne de paiement.
-- Les paiements encaissés sont conservés pour laisser une trace et signaler le
-- remboursement à traiter. Seuls les paiements encore ouverts sont annulés.
create or replace function public.admin_cancel_reservation_from_payment(
  target_payment_id uuid
)
returns table (
  reservation_id uuid,
  reservation_status public.reservation_status,
  refund_required boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  payment_row public.payments;
  reservation_row public.reservations;
  cancelled_row public.reservations;
  requires_refund boolean := false;
begin
  if actor_id is null or not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  select payment.*
  into payment_row
  from public.payments as payment
  where payment.id = target_payment_id
  for update;

  if payment_row.id is null then
    raise exception 'Paiement introuvable' using errcode = 'P0002';
  end if;

  select reservation.*
  into reservation_row
  from public.reservations as reservation
  where reservation.id = payment_row.reservation_id
  for update;

  if reservation_row.id is null then
    raise exception 'Réservation introuvable' using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.payments as payment
    where payment.reservation_id = reservation_row.id
      and payment.status = 'paid'
  )
  into requires_refund;

  if reservation_row.status = 'cancelled' then
    return query
    select reservation_row.id, reservation_row.status, requires_refund;
    return;
  end if;

  if reservation_row.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut pas être annulée depuis les paiements'
      using errcode = '22023';
  end if;

  update public.reservations as reservation
  set status = 'cancelled',
      payment_status = case
        when requires_refund then reservation.payment_status
        else 'cancelled'::public.payment_status
      end,
      cancelled_at = now(),
      cancelled_by = actor_id,
      cancellation_reason = 'Annulation administrateur depuis le suivi des paiements',
      updated_at = now(),
      updated_by = actor_id
  where reservation.id = reservation_row.id
  returning reservation.* into cancelled_row;

  update public.calendar_occupations as occupation
  set cancelled_at = coalesce(occupation.cancelled_at, now()),
      updated_at = now(),
      updated_by = actor_id
  where occupation.reservation_id = reservation_row.id
    and occupation.cancelled_at is null;

  update public.payments as payment
  set status = 'cancelled',
      failure_reason = coalesce(payment.failure_reason, 'Réservation annulée par un administrateur'),
      updated_at = now()
  where payment.reservation_id = reservation_row.id
    and payment.status in ('pending', 'authorized');

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

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    reservation_row.id,
    'cancelled_by_admin_from_payment',
    actor_id,
    to_jsonb(reservation_row),
    to_jsonb(cancelled_row)
  );

  begin
    perform public.publish_released_reservation_slot_notification(
      reservation_row.id,
      actor_id
    );
  exception when others then
    raise warning 'Notification de créneau libéré non publiée pour la réservation %: %',
      reservation_row.id,
      sqlerrm;
  end;

  return query
  select cancelled_row.id, cancelled_row.status, requires_refund;
end;
$$;

revoke all on function public.admin_cancel_reservation_from_payment(uuid)
from public, anon, authenticated;
grant execute on function public.admin_cancel_reservation_from_payment(uuid)
to authenticated;

-- Nettoyage destructif réservé au mode test. Il supprime toute la réservation
-- de test (et donc toutes ses éventuelles parts de paiement), jamais un
-- encaissement possédant un identifiant fournisseur.
create or replace function public.admin_delete_test_payment(
  target_payment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  reservation_id_to_delete uuid;
  related_communication_ids uuid[] := array[]::uuid[];
begin
  if actor_id is null or not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if coalesce(
    (select settings.payment_mode from public.reservation_settings as settings where settings.id = true),
    'test'
  ) <> 'test'
  then
    raise exception 'La suppression définitive est réservée aux paiements de test'
      using errcode = '42501';
  end if;

  select payment.reservation_id
  into reservation_id_to_delete
  from public.payments as payment
  where payment.id = target_payment_id
  for update;

  if reservation_id_to_delete is null then
    raise exception 'Paiement introuvable' using errcode = 'P0002';
  end if;

  perform 1
  from public.reservations as reservation
  where reservation.id = reservation_id_to_delete
  for update;

  if exists (
    select 1
    from public.payments as payment
    where payment.reservation_id = reservation_id_to_delete
      and (
        payment.provider_checkout_intent_id is not null
        or payment.provider_order_id is not null
        or payment.provider_payment_id is not null
      )
  ) then
    raise exception 'Ce paiement contient une référence fournisseur et ne peut pas être supprimé'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct event.communication_id), array[]::uuid[])
  into related_communication_ids
  from public.reservation_payment_notification_events as event
  join public.payments as payment on payment.id = event.payment_id
  where payment.reservation_id = reservation_id_to_delete;

  delete from public.communication_audit_log as audit
  where audit.communication_id = any(related_communication_ids);

  delete from public.club_communications as communication
  where communication.id = any(related_communication_ids);

  delete from public.payment_events as event
  where event.payment_id in (
    select payment.id
    from public.payments as payment
    where payment.reservation_id = reservation_id_to_delete
  );

  delete from public.reservation_payment_notification_events as event
  where event.payment_id in (
    select payment.id
    from public.payments as payment
    where payment.reservation_id = reservation_id_to_delete
  );

  delete from public.calendar_occupation_audit_log as audit
  where audit.occupation_id in (
    select occupation.id
    from public.calendar_occupations as occupation
    where occupation.reservation_id = reservation_id_to_delete
  );

  delete from public.calendar_occupations as occupation
  where occupation.reservation_id = reservation_id_to_delete;

  delete from public.reservation_audit_log as audit
  where audit.reservation_id = reservation_id_to_delete;

  delete from public.payments as payment
  where payment.reservation_id = reservation_id_to_delete;

  delete from public.reservations as reservation
  where reservation.id = reservation_id_to_delete;

  return reservation_id_to_delete;
end;
$$;

revoke all on function public.admin_delete_test_payment(uuid)
from public, anon, authenticated;
grant execute on function public.admin_delete_test_payment(uuid)
to authenticated;

-- Le suivi admin expose aussi l'état de la réservation et les actions sûres
-- disponibles pour chaque ligne.
drop function if exists public.admin_list_payments(
  public.payment_status,
  timestamptz,
  timestamptz
);

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
  reservation_status public.reservation_status,
  provider_checkout_intent_id text,
  provider_order_id text,
  provider_payment_id text,
  failure_reason text,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz,
  payment_mode text,
  can_cancel_reservation boolean,
  can_delete_test boolean
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
    reservation.status,
    payment.provider_checkout_intent_id,
    payment.provider_order_id,
    payment.provider_payment_id,
    payment.failure_reason,
    payment.paid_at,
    payment.expires_at,
    payment.created_at,
    settings.payment_mode,
    reservation.status in ('pending', 'confirmed'),
    settings.payment_mode = 'test'
      and not exists (
        select 1
        from public.payments as sibling
        where sibling.reservation_id = reservation.id
          and (
            sibling.provider_checkout_intent_id is not null
            or sibling.provider_order_id is not null
            or sibling.provider_payment_id is not null
          )
      )
  from public.payments as payment
  join public.reservations as reservation on reservation.id = payment.reservation_id
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  cross join public.reservation_settings as settings
  left join public.profiles as payer
    on payer.id = coalesce(payment.payer_profile_id, reservation.user_id)
  where settings.id = true
    and (status_filter is null or payment.status = status_filter)
    and (range_start is null or payment.created_at >= range_start)
    and (range_end is null or payment.created_at < range_end)
  order by payment.created_at desc;
end;
$$;

revoke all on function public.admin_list_payments(
  public.payment_status,
  timestamptz,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.admin_list_payments(
  public.payment_status,
  timestamptz,
  timestamptz
) to authenticated;

commit;
