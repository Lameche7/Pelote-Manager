create or replace function public.cancel_unstarted_payment(
  target_payment_id uuid,
  target_reservation_id uuid,
  cancellation_reason text default 'Impossible de démarrer le paiement HelloAsso'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments;
  reservation_row public.reservations;
begin
  select payment.*
  into payment_row
  from public.payments as payment
  where payment.id = target_payment_id
    and payment.reservation_id = target_reservation_id
  for update;

  if payment_row.id is null
    or payment_row.status <> 'pending'
    or payment_row.provider_checkout_intent_id is not null then
    return false;
  end if;

  select reservation.*
  into reservation_row
  from public.reservations as reservation
  where reservation.id = target_reservation_id
  for update;

  if reservation_row.id is null
    or reservation_row.status <> 'pending'
    or not (
      reservation_row.user_id is null
      or reservation_row.user_id = auth.uid()
    ) then
    return false;
  end if;

  update public.payments
  set status = 'failed',
      failure_reason = left(coalesce(nullif(btrim(cancellation_reason), ''), 'Impossible de démarrer le paiement HelloAsso'), 500),
      updated_at = now()
  where id = payment_row.id;

  update public.reservations
  set status = 'expired',
      payment_status = 'failed',
      updated_at = now(),
      updated_by = auth.uid()
  where id = reservation_row.id;

  update public.calendar_occupations
  set cancelled_at = coalesce(cancelled_at, now()),
      updated_at = now(),
      updated_by = auth.uid()
  where reservation_id = reservation_row.id
    and cancelled_at is null;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    new_data
  ) values (
    reservation_row.id,
    'payment_checkout_failed',
    auth.uid(),
    jsonb_build_object(
      'payment_id', payment_row.id,
      'reason', coalesce(nullif(btrim(cancellation_reason), ''), 'Impossible de démarrer le paiement HelloAsso')
    )
  );

  return true;
end;
$$;

revoke all on function public.cancel_unstarted_payment(uuid, uuid, text) from public;
grant execute on function public.cancel_unstarted_payment(uuid, uuid, text) to anon, authenticated;
