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
  requires_refund boolean;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select *
  into reservation_row
  from public.reservations
  where id = target_reservation_id
    and user_id = actor_id
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
      false;
    return;
  end if;

  if reservation_row.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut plus être annulée'
      using errcode = '22023';
  end if;

  select settings.cancellation_notice_hours
  into notice_hours
  from public.reservation_settings as settings
  where settings.id = true;

  notice_hours := coalesce(notice_hours, 8);

  if now() > reservation_row.starts_at - make_interval(hours => notice_hours) then
    raise exception 'Le délai d’annulation en ligne est dépassé'
      using errcode = '22023';
  end if;

  requires_refund := reservation_row.payment_required
    and reservation_row.payment_status = 'paid';

  update public.reservations
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = actor_id,
      cancellation_reason = 'Annulation en ligne par le réservant',
      updated_at = now(),
      updated_by = actor_id
  where id = target_reservation_id
  returning * into cancelled_row;

  update public.calendar_occupations
  set cancelled_at = coalesce(cancelled_at, now()),
      updated_at = now(),
      updated_by = actor_id
  where reservation_id = target_reservation_id
    and cancelled_at is null;

  update public.payments
  set status = 'cancelled',
      failure_reason = coalesce(failure_reason, 'Réservation annulée avant paiement'),
      updated_at = now()
  where reservation_id = target_reservation_id
    and status in ('pending', 'authorized');

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
