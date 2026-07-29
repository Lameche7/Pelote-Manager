create or replace function public.reset_reservation_test_data()
returns table (
  deleted_reservations integer,
  deleted_occupations integer,
  deleted_payments integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_count integer;
  occupation_count integer;
  payment_count integer;
begin
  select count(*) into reservation_count from public.reservations;
  select count(*) into occupation_count
  from public.calendar_occupations
  where reservation_id is not null;
  select count(*) into payment_count from public.payments;

  delete from public.payment_events;
  delete from public.payments;
  delete from public.calendar_occupations where reservation_id is not null;
  delete from public.reservation_audit_log;
  delete from public.reservations;

  return query select reservation_count, occupation_count, payment_count;
end;
$$;

-- Fonction destructive destinée exclusivement à l'éditeur SQL Supabase.
revoke all on function public.reset_reservation_test_data() from public;
revoke execute on function public.reset_reservation_test_data() from anon, authenticated;
grant execute on function public.reset_reservation_test_data() to postgres;
