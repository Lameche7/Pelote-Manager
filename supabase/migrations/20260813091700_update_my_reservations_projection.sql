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

revoke all on function public.list_my_reservations() from public;
grant execute on function public.list_my_reservations() to authenticated;
