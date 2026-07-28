alter table public.reservation_settings
add column cancellation_notice_hours integer not null default 24
check (cancellation_notice_hours >= 0);

create function public.list_my_reservations()
returns table (
  id uuid,
  resource_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  reservation_status public.reservation_status,
  payment_status public.payment_status,
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
    reservation.price_cents,
    reservation.currency,
    payment.id,
    payment.expires_at,
    payment.redirect_url,
    reservation.starts_at - make_interval(hours => settings.cancellation_notice_hours),
    reservation.status in ('pending', 'confirmed')
      and reservation.starts_at > now()
      and now() <= reservation.starts_at - make_interval(hours => settings.cancellation_notice_hours),
    reservation.created_at
  from public.reservations as reservation
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  cross join public.reservation_settings as settings
  left join lateral (
    select candidate.id, candidate.expires_at, candidate.redirect_url
    from public.payments as candidate
    where candidate.reservation_id = reservation.id
    order by candidate.created_at desc
    limit 1
  ) as payment on true
  where auth.uid() is not null
    and reservation.user_id = auth.uid()
  order by reservation.starts_at desc;
$$;

create function public.cancel_my_reservation(target_reservation_id uuid)
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
  reservation_row public.reservations;
  notice_hours integer;
  requires_refund boolean;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select * into reservation_row
  from public.reservations
  where id = target_reservation_id
    and user_id = auth.uid()
  for update;

  if reservation_row.id is null then
    raise exception 'Réservation introuvable' using errcode = 'P0002';
  end if;

  if reservation_row.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut plus être annulée' using errcode = '22023';
  end if;

  select cancellation_notice_hours into notice_hours
  from public.reservation_settings
  where id;

  if now() > reservation_row.starts_at - make_interval(hours => notice_hours) then
    raise exception 'Le délai d’annulation en ligne est dépassé' using errcode = '22023';
  end if;

  requires_refund := reservation_row.payment_status = 'paid';

  update public.reservations
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = 'Annulation en ligne par le réservant',
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_reservation_id;

  update public.calendar_occupations
  set cancelled_at = coalesce(cancelled_at, now()),
      updated_at = now(),
      updated_by = auth.uid()
  where reservation_id = target_reservation_id;

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
    auth.uid(),
    to_jsonb(reservation_row),
    jsonb_build_object(
      'refund_required', requires_refund,
      'cancellation_notice_hours', notice_hours
    )
  );

  return query
  select
    target_reservation_id,
    'cancelled'::public.reservation_status,
    case
      when requires_refund then 'paid'::public.payment_status
      else 'cancelled'::public.payment_status
    end,
    requires_refund;
end;
$$;

revoke all on function public.list_my_reservations() from public;
revoke all on function public.cancel_my_reservation(uuid) from public;

grant execute on function public.list_my_reservations() to authenticated;
grant execute on function public.cancel_my_reservation(uuid) to authenticated;
