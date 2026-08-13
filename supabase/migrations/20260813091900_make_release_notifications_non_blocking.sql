create or replace function public.cancel_reservation(
  target_reservation_id uuid,
  cancellation_reason text default null
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  existing_reservation public.reservations;
  cancelled_reservation public.reservations;
  notice_hours integer;
  actor_is_admin boolean := public.is_profile_admin();
begin
  if actor_id is null then
    raise exception 'Authentification requise' using errcode = '42501';
  end if;

  select *
  into existing_reservation
  from public.reservations
  where id = target_reservation_id
  for update;

  if existing_reservation.id is null then
    raise exception 'Réservation introuvable' using errcode = 'P0002';
  end if;

  if existing_reservation.user_id is distinct from actor_id
    and not actor_is_admin then
    raise exception 'Annulation interdite' using errcode = '42501';
  end if;

  if existing_reservation.status = 'cancelled' then
    return existing_reservation;
  end if;

  if existing_reservation.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut plus être annulée'
      using errcode = 'P0001';
  end if;

  if not actor_is_admin then
    select settings.cancellation_notice_hours
    into strict notice_hours
    from public.reservation_settings as settings
    where settings.id;

    if now() > existing_reservation.starts_at - make_interval(hours => notice_hours) then
      raise exception 'Le délai d’annulation en ligne est dépassé'
        using errcode = '22023';
    end if;
  end if;

  update public.reservations
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = actor_id,
      cancellation_reason = nullif(btrim(cancellation_reason), ''),
      updated_at = now(),
      updated_by = actor_id
  where id = target_reservation_id
  returning * into cancelled_reservation;

  update public.calendar_occupations
  set cancelled_at = now(),
      updated_at = now(),
      updated_by = actor_id
  where reservation_id = target_reservation_id
    and cancelled_at is null;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    target_reservation_id,
    'cancelled',
    actor_id,
    to_jsonb(existing_reservation),
    to_jsonb(cancelled_reservation)
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

  return cancelled_reservation;
end;
$$;

revoke all on function public.cancel_reservation(uuid, text) from public;
grant execute on function public.cancel_reservation(uuid, text) to authenticated;
