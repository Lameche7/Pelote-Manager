begin;

drop function if exists public.get_payment_for_checkout(uuid);

create function public.get_payment_for_checkout(target_payment_id uuid)
returns table(
  payment_id uuid,
  reservation_id uuid,
  licence_request_id uuid,
  amount_cents integer,
  currency text,
  item_name text,
  payer_name text,
  payer_email text,
  starts_at timestamptz,
  resource_name text,
  expires_at timestamptz,
  payment_plan text,
  payment_context text
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  return query
  select
    payment.id,
    reservation.id,
    payment.licence_request_id,
    payment.amount_cents,
    payment.currency,
    'Réservation ' || resource.name,
    coalesce(
      nullif(btrim(payer_profile.display_name),''),
      reservation.guest_name,
      'Utilisateur'
    ),
    coalesce(payer_profile.email,reservation.guest_email,''),
    reservation.starts_at,
    resource.name,
    payment.expires_at,
    reservation.payment_plan,
    'reservation'::text
  from public.payments payment
  join public.reservations reservation on reservation.id=payment.reservation_id
  join public.reservable_resources resource on resource.id=reservation.resource_id
  left join public.profiles payer_profile
    on payer_profile.id=coalesce(payment.payer_profile_id,reservation.user_id)
  where payment.id=target_payment_id
    and payment.payment_context='reservation'
    and payment.status='pending'
    and payment.expires_at>now()
    and reservation.status='pending'
    and (
      payment.payer_profile_id=auth.uid()
      or (
        payment.payer_profile_id is null
        and (reservation.user_id=auth.uid() or reservation.user_id is null)
      )
    )

  union all

  select
    payment.id,
    null::uuid,
    request.id,
    payment.amount_cents,
    payment.currency,
    concat(
      case when request.request_type='renewal'
        then 'Renouvellement licence '
        else 'Première licence '
      end,
      season.name
    ),
    coalesce(
      nullif(btrim(profile.display_name),''),
      nullif(btrim(concat_ws(' ',request.first_name,request.last_name)),''),
      'Utilisateur'
    ),
    profile.email,
    null::timestamptz,
    club.name,
    payment.expires_at,
    'licence'::text,
    'licence'::text
  from public.payments payment
  join public.licence_requests request on request.id=payment.licence_request_id
  join public.club_seasons season on season.id=request.club_season_id
  join public.clubs club on club.id=request.club_id
  join public.profiles profile on profile.id=request.profile_id
  where payment.id=target_payment_id
    and payment.payment_context='licence'
    and payment.status='pending'
    and payment.expires_at>now()
    and request.profile_id=auth.uid()
    and request.status not in ('approved','licensed','cancelled');
end;
$$;

revoke all on function public.get_payment_for_checkout(uuid) from public,anon,authenticated;
grant execute on function public.get_payment_for_checkout(uuid) to anon,authenticated;

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
set search_path=''
as $$
declare
  payment_row public.payments;
  normalized_status public.payment_status;
  request_row public.licence_requests%rowtype;
begin
  insert into public.payment_events(
    payment_id,provider_event_key,event_type,payload
  ) values (
    target_payment_id,event_key,event_type,event_payload
  ) on conflict(provider,provider_event_key) do nothing;

  if not found then return false; end if;

  select payment.* into payment_row
  from public.payments payment
  where payment.id=target_payment_id
  for update;

  if payment_row.id is null then
    raise exception 'Paiement introuvable' using errcode='P0002';
  end if;

  normalized_status:=case lower(provider_state)
    when 'authorized' then 'paid'::public.payment_status
    when 'paid' then 'paid'::public.payment_status
    when 'refunded' then 'refunded'::public.payment_status
    when 'refused' then 'failed'::public.payment_status
    when 'failed' then 'failed'::public.payment_status
    when 'cancelled' then 'cancelled'::public.payment_status
    else payment_row.status
  end;

  if normalized_status='paid' and paid_amount_cents<>payment_row.amount_cents then
    normalized_status:='failed';
  end if;

  update public.payments payment set
    status=normalized_status,
    provider_checkout_intent_id=coalesce(checkout_intent_id,payment.provider_checkout_intent_id),
    provider_order_id=coalesce(order_id,payment.provider_order_id),
    provider_payment_id=coalesce(apply_helloasso_payment_event.provider_payment_id,payment.provider_payment_id),
    paid_at=case when normalized_status='paid' then coalesce(payment.paid_at,now()) else payment.paid_at end,
    refunded_at=case when normalized_status='refunded' then coalesce(payment.refunded_at,now()) else payment.refunded_at end,
    failure_reason=case
      when normalized_status='failed' and paid_amount_cents<>payment.amount_cents
        then 'Montant HelloAsso différent du montant attendu'
      else payment.failure_reason end,
    updated_at=now()
  where payment.id=target_payment_id
  returning payment.* into payment_row;

  if payment_row.licence_request_id is not null then
    select * into request_row
    from public.licence_requests
    where id=payment_row.licence_request_id
    for update;

    if request_row.id is not null
      and request_row.status not in ('approved','licensed','cancelled')
    then
      update public.licence_requests set
        status=case
          when normalized_status='paid' and request_row.document_path is not null
            then 'ready_for_review'::public.licence_request_status
          when normalized_status='paid'
            then 'pending_documents'::public.licence_request_status
          when request_row.document_path is not null
            then 'pending_payment'::public.licence_request_status
          else 'pending_documents'::public.licence_request_status
        end,
        updated_at=now()
      where id=request_row.id;
    end if;
  else
    if normalized_status='paid' then
      update public.club_communications communication set
        status='archived',
        archived_at=coalesce(communication.archived_at,now()),
        updated_at=now()
      where communication.id=(
        select event.communication_id
        from public.reservation_payment_notification_events event
        where event.payment_id=payment_row.id
      )
        and communication.status='published';
    end if;

    perform public.reconcile_reservation_payment_state(payment_row.reservation_id);

    insert into public.reservation_audit_log(
      reservation_id,action,new_data
    ) values (
      payment_row.reservation_id,
      'payment_status_changed:'||normalized_status::text,
      jsonb_build_object(
        'payment_id',payment_row.id,
        'payer_profile_id',payment_row.payer_profile_id,
        'event_type',event_type
      )
    );
  end if;

  update public.payment_events
  set processed_at=now()
  where provider='helloasso' and provider_event_key=event_key;

  return true;
end;
$$;

revoke all on function public.apply_helloasso_payment_event(
  text,text,jsonb,uuid,text,text,text,integer,text
) from public,anon,authenticated;
grant execute on function public.apply_helloasso_payment_event(
  text,text,jsonb,uuid,text,text,text,integer,text
) to service_role;

commit;
