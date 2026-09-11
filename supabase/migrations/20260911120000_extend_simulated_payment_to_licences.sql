begin;

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
  licence_request_row public.licence_requests%rowtype;
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
  where payment.id = target_payment_id
    and payment.status = 'pending'
    and payment.provider_checkout_intent_id is null
    and (
      (
        payment.payment_context = 'reservation'
        and exists (
          select 1
          from public.reservations as reservation
          where reservation.id = payment.reservation_id
            and (
              payment.payer_profile_id = actor_id
              or (
                payment.payer_profile_id is null
                and (
                  reservation.user_id = actor_id
                  or reservation.user_id is null
                )
              )
            )
        )
      )
      or
      (
        payment.payment_context = 'licence'
        and exists (
          select 1
          from public.licence_requests as request
          where request.id = payment.licence_request_id
            and request.profile_id = actor_id
            and request.status not in ('approved', 'licensed', 'cancelled')
        )
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
      metadata = metadata || jsonb_build_object(
        'simulated', true,
        'outcome', simulated_outcome
      ),
      updated_at = now()
  where id = payment_row.id
  returning * into payment_row;

  if payment_row.payment_context = 'licence' then
    select request.*
    into licence_request_row
    from public.licence_requests as request
    where request.id = payment_row.licence_request_id
    for update;

    if licence_request_row.id is not null
      and licence_request_row.status not in ('approved', 'licensed', 'cancelled')
    then
      update public.licence_requests
      set status = case
          when final_status = 'paid'
            and licence_request_row.document_path is not null
            then 'ready_for_review'::public.licence_request_status
          when final_status = 'paid'
            then 'pending_documents'::public.licence_request_status
          when licence_request_row.document_path is not null
            then 'pending_payment'::public.licence_request_status
          else 'pending_documents'::public.licence_request_status
        end,
        updated_at = now()
      where id = licence_request_row.id;
    end if;

    return simulated_outcome;
  end if;

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

commit;
