-- A championship booking has an unambiguous match identity and does not require
-- falsely assigning the booking to the admin creating it.
alter table public.reservations
  drop constraint reservations_customer_identity;
alter table public.reservations
  add constraint reservations_customer_identity check (
    ((user_id is not null and guest_email is null)
      or (user_id is null and guest_email is not null and btrim(guest_email) <> ''))
    or (championship_match_id is not null and user_id is null and guest_email is null)
  );
