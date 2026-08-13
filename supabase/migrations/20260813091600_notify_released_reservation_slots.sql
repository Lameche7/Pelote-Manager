create or replace function public.publish_released_reservation_slot_notification(
  target_reservation_id uuid,
  excluded_profile_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_row public.reservations;
  resource_row public.reservable_resources;
  created_communication_id uuid;
  local_slot text;
begin
  select *
  into reservation_row
  from public.reservations
  where id = target_reservation_id;

  if reservation_row.id is null or reservation_row.starts_at <= now() then
    return null;
  end if;

  select *
  into resource_row
  from public.reservable_resources
  where id = reservation_row.resource_id;

  if resource_row.id is null then
    return null;
  end if;

  local_slot := to_char(
    reservation_row.starts_at at time zone resource_row.timezone,
    'DD/MM/YYYY "à" HH24:MI'
  );

  insert into public.club_communications (
    club_id,
    title,
    body,
    priority,
    status,
    show_on_home,
    published_at,
    expires_at,
    created_by,
    updated_by
  ) values (
    resource_row.club_id,
    'Créneau libéré · ' || resource_row.name,
    'Un créneau vient de se libérer le ' || local_slot
      || ' au ' || resource_row.name
      || '. Il est de nouveau disponible à la réservation.',
    'normal',
    'published',
    false,
    now(),
    reservation_row.starts_at,
    excluded_profile_id,
    excluded_profile_id
  )
  returning id into created_communication_id;

  insert into public.communication_deliveries (
    communication_id,
    club_id,
    club_member_id,
    profile_id_at_publication,
    email_snapshot,
    email_status
  )
  select
    created_communication_id,
    resource_row.club_id,
    member.id,
    profile.id,
    coalesce(nullif(btrim(member.email), ''), nullif(btrim(profile.email), '')),
    case
      when coalesce(nullif(btrim(member.email), ''), nullif(btrim(profile.email), '')) is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from public.club_members as member
  left join public.profiles as profile on profile.member_id = member.id
  where member.club_id = resource_row.club_id
    and member.is_active
    and (excluded_profile_id is null or profile.id is distinct from excluded_profile_id)
  on conflict (communication_id, club_member_id) do nothing;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  ) values (
    resource_row.club_id,
    created_communication_id,
    'published',
    excluded_profile_id,
    jsonb_build_object(
      'source', 'reservation_cancelled',
      'reservation_id', target_reservation_id,
      'recipient_count', (
        select count(*)
        from public.communication_deliveries as delivery
        where delivery.communication_id = created_communication_id
      )
    )
  );

  return created_communication_id;
end;
$$;

revoke all on function public.publish_released_reservation_slot_notification(uuid, uuid)
from public, anon, authenticated;

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

  perform public.publish_released_reservation_slot_notification(
    target_reservation_id,
    actor_id
  );

  return cancelled_reservation;
end;
$$;

revoke all on function public.cancel_reservation(uuid, text) from public;
grant execute on function public.cancel_reservation(uuid, text) to authenticated;

create or replace function public.cancel_my_reservation(target_reservation_id uuid)
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
  cancelled_row public.reservations;
  requires_refund boolean;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select *
  into reservation_row
  from public.reservations
  where id = target_reservation_id
    and user_id = auth.uid();

  if reservation_row.id is null then
    raise exception 'Réservation introuvable' using errcode = 'P0002';
  end if;

  requires_refund := reservation_row.payment_required
    and reservation_row.payment_status = 'paid';

  cancelled_row := public.cancel_reservation(
    target_reservation_id,
    'Annulation en ligne par le réservant'
  );

  update public.payments
  set status = 'cancelled',
      failure_reason = coalesce(failure_reason, 'Réservation annulée avant paiement'),
      updated_at = now()
  where reservation_id = target_reservation_id
    and status in ('pending', 'authorized');

  return query
  select
    cancelled_row.id,
    cancelled_row.status,
    cancelled_row.payment_status,
    requires_refund;
end;
$$;

revoke all on function public.cancel_my_reservation(uuid) from public;
grant execute on function public.cancel_my_reservation(uuid) to authenticated;
