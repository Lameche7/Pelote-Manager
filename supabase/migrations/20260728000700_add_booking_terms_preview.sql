create function public.get_current_reservation_terms(
  target_starts_at timestamptz
)
returns table (
  customer_type public.reservation_customer_type,
  advance_hours integer,
  price_cents integer,
  max_active_reservations integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from public.get_reservation_terms(auth.uid(), target_starts_at);
$$;

revoke all on function public.get_current_reservation_terms(timestamptz) from public;
grant execute on function public.get_current_reservation_terms(timestamptz)
to anon, authenticated;
