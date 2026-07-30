-- Guest columns are deliberately retained for displaying historical bookings.
-- Every command creating a new booking now requires an authenticated profile.
create or replace function public.create_reservation(
  target_resource_id uuid,
  target_starts_at timestamptz,
  guest_name text default null,
  guest_email text default null,
  guest_phone text default null
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  settings public.reservation_settings%rowtype;
  target_ends_at timestamptz;
  terms record;
  created_reservation public.reservations;
begin
  if actor_id is null then
    raise exception 'Connexion requise pour réserver' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = actor_id) then
    raise exception 'Profil utilisateur requis pour réserver' using errcode = '42501';
  end if;

  select * into strict settings from public.reservation_settings where id;
  target_ends_at := target_starts_at + make_interval(mins => settings.default_duration_minutes);
  select * into strict terms from public.assert_reservation_slot_allowed(
    target_resource_id, actor_id, target_starts_at, target_ends_at, null
  );

  insert into public.reservations (
    resource_id, user_id, guest_name, guest_email, guest_phone, customer_type,
    status, starts_at, ends_at, price_cents, created_by, updated_by
  ) values (
    target_resource_id, actor_id, null, null, null, terms.customer_type,
    'confirmed', target_starts_at, target_ends_at, terms.price_cents, actor_id, actor_id
  ) returning * into created_reservation;

  insert into public.calendar_occupations (
    resource_id, occupation_type, reservation_id, title, starts_at, ends_at, created_by, updated_by
  ) values (
    target_resource_id, 'reservation', created_reservation.id, 'Réservation',
    target_starts_at, target_ends_at, actor_id, actor_id
  );

  insert into public.reservation_audit_log (reservation_id, action, actor_id, new_data)
  values (created_reservation.id, 'created', actor_id, to_jsonb(created_reservation));
  return created_reservation;
end;
$$;

revoke all on function public.create_reservation(uuid, timestamptz, text, text, text) from anon;
grant execute on function public.create_reservation(uuid, timestamptz, text, text, text) to authenticated;
revoke all on function public.reserve_for_payment(uuid, timestamptz, text, text, text) from anon;
grant execute on function public.reserve_for_payment(uuid, timestamptz, text, text, text) to authenticated;
