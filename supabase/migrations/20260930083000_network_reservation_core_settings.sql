begin;

CREATE OR REPLACE FUNCTION public.admin_assert_reservation_slot_allowed(target_resource_id uuid, target_user_id uuid, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone, excluded_reservation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(customer_type reservation_customer_type, price_cents integer, booking_opens_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  resource_active boolean;
  resource_timezone text;
  target_club_id uuid;
  settings public.club_reservation_settings%rowtype;
  terms record;
  championship_access record;
  active_count integer;
  calculated_booking_opens_at timestamptz;
  local_start timestamp;
  local_end timestamp;
  regular_opening_allowed boolean;
  released_permanent_at timestamptz;
  effective_advance_hours integer;
  effective_max_active integer;
begin
  if target_ends_at <= target_starts_at then
    raise exception 'La fin du créneau doit être postérieure au début' using errcode = '22007';
  end if;

  select club_id, is_active, timezone
  into target_club_id, resource_active, resource_timezone
  from public.reservable_resources
  where id = target_resource_id;

  if resource_active is distinct from true then
    raise exception 'La ressource demandée est indisponible' using errcode = 'P0001';
  end if;

  if public.admin_current_club_id() is distinct from target_club_id
    or not public.has_club_permission(target_club_id, 'reservations.manage')
  then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  select *
  into strict settings
  from public.club_reservation_settings
  where club_id = target_club_id;

  if extract(epoch from (target_ends_at - target_starts_at))::integer / 60
    <> settings.default_duration_minutes then
    raise exception 'La durée du créneau ne respecte pas la durée configurée' using errcode = 'P0001';
  end if;

  local_start := target_starts_at at time zone resource_timezone;
  local_end := target_ends_at at time zone resource_timezone;

  select exists (
    select 1
    from public.resource_opening_hours as hours
    where hours.resource_id = target_resource_id
      and hours.weekday = extract(dow from local_start)::smallint
      and hours.is_open
      and hours.opens_at <= local_start::time
      and hours.closes_at >= local_end::time
      and mod(
        extract(epoch from (local_start::time - hours.opens_at))::bigint,
        settings.booking_step_minutes::bigint * 60
      ) = 0
  ) into regular_opening_allowed;

  select occurrence.released_at
  into released_permanent_at
  from public.permanent_slot_occurrences as occurrence
  join public.permanent_slots as permanent_slot
    on permanent_slot.id = occurrence.permanent_slot_id and permanent_slot.is_active
  join public.calendar_occupations as private_occupation
    on private_occupation.id = occurrence.occupation_id
  where permanent_slot.resource_id = target_resource_id
    and occurrence.status = 'released'::public.permanent_slot_occurrence_status
    and private_occupation.starts_at = target_starts_at
    and private_occupation.ends_at = target_ends_at
  order by occurrence.released_at desc
  limit 1;

  select * into strict championship_access
  from public.get_championship_reservation_access(
    target_resource_id, target_user_id, target_starts_at, target_ends_at
  );

  if local_start::date <> local_end::date
    or (
      not regular_opening_allowed
      and not championship_access.is_priority
      and released_permanent_at is null
    ) then
    raise exception 'Ce créneau se situe hors des horaires de réservation' using errcode = 'P0001';
  end if;

  select * into strict terms
  from public.get_reservation_terms_for_resource(
    target_resource_id,
    target_user_id,
    target_starts_at
  );

  effective_advance_hours := coalesce(championship_access.advance_hours, terms.advance_hours);
  effective_max_active := coalesce(championship_access.max_active_reservations, terms.max_active_reservations);

  calculated_booking_opens_at := public.get_reservation_booking_opens_at(
    target_starts_at, effective_advance_hours
  );
  if released_permanent_at is not null then
    calculated_booking_opens_at := least(calculated_booking_opens_at, released_permanent_at);
  end if;

  if now() + make_interval(mins => settings.minimum_notice_minutes) >= target_starts_at then
    raise exception 'Le délai minimum avant réservation n''est pas respecté' using errcode = 'P0001';
  end if;

  select count(*) into active_count
  from public.reservations as active_reservation
  join public.reservable_resources as active_resource
    on active_resource.id = active_reservation.resource_id
  where active_reservation.user_id = target_user_id
    and active_reservation.id is distinct from excluded_reservation_id
    and active_reservation.status in ('pending', 'confirmed')
    and active_reservation.ends_at > now()
    and active_resource.club_id = target_club_id;

  if active_count >= effective_max_active then
    raise exception 'Le nombre maximal de réservations actives est atteint' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.calendar_occupations
    where resource_id = target_resource_id
      and cancelled_at is null
      and (excluded_reservation_id is null or reservation_id is distinct from excluded_reservation_id)
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(target_starts_at, target_ends_at, '[)')
  ) then
    raise exception 'Ce créneau est déjà occupé' using errcode = '23P01';
  end if;

  return query select terms.customer_type, terms.price_cents, calculated_booking_opens_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_reservation_for_user(target_user_id uuid, target_resource_id uuid, target_starts_at timestamp with time zone)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  settings public.club_reservation_settings%rowtype;
  target_club_id uuid;
  target_ends_at timestamptz;
  terms record;
  created public.reservations;
begin
  select resource.club_id
  into target_club_id
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null
    or public.admin_current_club_id() is distinct from target_club_id
    or not public.has_club_permission(target_club_id, 'reservations.manage')
  then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if target_user_id is null or not exists(select 1 from public.profiles where id = target_user_id) then
    raise exception 'Un compte utilisateur existant est obligatoire' using errcode = '22023';
  end if;

  select *
  into strict settings
  from public.club_reservation_settings
  where club_id = target_club_id;
  target_ends_at := target_starts_at + make_interval(mins => settings.default_duration_minutes);

  select * into strict terms
  from public.admin_assert_reservation_slot_allowed(
    target_resource_id, target_user_id, target_starts_at, target_ends_at, null
  );

  insert into public.reservations(
    resource_id,user_id,customer_type,status,starts_at,ends_at,price_cents,created_by,updated_by
  ) values(
    target_resource_id,target_user_id,terms.customer_type,'confirmed',
    target_starts_at,target_ends_at,terms.price_cents,actor,actor
  ) returning * into created;

  insert into public.calendar_occupations(
    resource_id,occupation_type,reservation_id,title,starts_at,ends_at,created_by,updated_by
  ) values(
    target_resource_id,'reservation',created.id,'Réservation',
    target_starts_at,target_ends_at,actor,actor
  );

  insert into public.reservation_audit_log(reservation_id,action,actor_id,new_data)
  values(
    created.id,
    case when now() < terms.booking_opens_at then 'admin_early_created_for_user' else 'admin_created_for_user' end,
    actor,
    to_jsonb(created) || jsonb_build_object('public_visible_at', terms.booking_opens_at)
  );

  return created;
exception when exclusion_violation then
  raise exception 'Ce créneau est déjà occupé' using errcode = '23P01';
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_preview_reservation(target_user_id uuid, target_resource_id uuid, target_starts_at timestamp with time zone)
 RETURNS TABLE(customer_type reservation_customer_type, price_cents integer, ends_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  settings public.club_reservation_settings%rowtype;
  target_club_id uuid;
  terms record;
  calculated_end timestamptz;
begin
  select resource.club_id
  into target_club_id
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null
    or public.admin_current_club_id() is distinct from target_club_id
    or not public.has_club_permission(target_club_id, 'reservations.manage')
  then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if target_user_id is null or not exists(select 1 from public.profiles where id = target_user_id) then
    raise exception 'Un compte utilisateur existant est obligatoire' using errcode = '22023';
  end if;

  select *
  into strict settings
  from public.club_reservation_settings
  where club_id = target_club_id;
  calculated_end := target_starts_at + make_interval(mins => settings.default_duration_minutes);

  select * into strict terms
  from public.admin_assert_reservation_slot_allowed(
    target_resource_id,target_user_id,target_starts_at,calculated_end,null
  );

  return query select terms.customer_type, terms.price_cents, calculated_end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assert_reservation_slot_allowed(target_resource_id uuid, target_user_id uuid, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone, excluded_reservation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(customer_type reservation_customer_type, price_cents integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  resource_active boolean;
  resource_timezone text;
  target_club_id uuid;
  settings public.club_reservation_settings%rowtype;
  terms record;
  championship_access record;
  active_count integer;
  booking_opens_at timestamptz;
  local_start timestamp;
  local_end timestamp;
  regular_opening_allowed boolean;
  released_permanent_at timestamptz;
  effective_advance_hours integer;
  effective_max_active integer;
begin
  if target_ends_at <= target_starts_at then
    raise exception 'La fin du créneau doit être postérieure au début'
      using errcode = '22007';
  end if;

  select club_id, is_active, timezone
  into target_club_id, resource_active, resource_timezone
  from public.reservable_resources
  where id = target_resource_id;

  if resource_active is distinct from true then
    raise exception 'La ressource demandée est indisponible'
      using errcode = 'P0001';
  end if;

  select *
  into strict settings
  from public.club_reservation_settings
  where club_id = target_club_id;

  if extract(epoch from (target_ends_at - target_starts_at))::integer / 60
    <> settings.default_duration_minutes then
    raise exception 'La durée du créneau ne respecte pas la durée configurée'
      using errcode = 'P0001';
  end if;

  local_start := target_starts_at at time zone resource_timezone;
  local_end := target_ends_at at time zone resource_timezone;

  select exists (
    select 1
    from public.resource_opening_hours as hours
    where hours.resource_id = target_resource_id
      and hours.weekday = extract(dow from local_start)::smallint
      and hours.is_open
      and hours.opens_at <= local_start::time
      and hours.closes_at >= local_end::time
      and mod(
        extract(epoch from (local_start::time - hours.opens_at))::bigint,
        settings.booking_step_minutes::bigint * 60
      ) = 0
  ) into regular_opening_allowed;

  select occurrence.released_at
  into released_permanent_at
  from public.permanent_slot_occurrences as occurrence
  join public.permanent_slots as slot
    on slot.id = occurrence.permanent_slot_id
   and slot.is_active
  join public.calendar_occupations as private_occupation
    on private_occupation.id = occurrence.occupation_id
  where slot.resource_id = target_resource_id
    and occurrence.status = 'released'::public.permanent_slot_occurrence_status
    and private_occupation.starts_at = target_starts_at
    and private_occupation.ends_at = target_ends_at
  order by occurrence.released_at desc
  limit 1;

  select *
  into strict championship_access
  from public.get_championship_reservation_access(
    target_resource_id,
    target_user_id,
    target_starts_at,
    target_ends_at
  );

  if local_start::date <> local_end::date
    or (
      not regular_opening_allowed
      and not championship_access.is_priority
      and released_permanent_at is null
    ) then
    raise exception 'Ce créneau se situe hors des horaires de réservation'
      using errcode = 'P0001';
  end if;

  select *
  into strict terms
  from public.get_reservation_terms_for_resource(
    target_resource_id,
    target_user_id,
    target_starts_at
  );

  effective_advance_hours := coalesce(
    championship_access.advance_hours,
    terms.advance_hours
  );
  effective_max_active := coalesce(
    championship_access.max_active_reservations,
    terms.max_active_reservations
  );

  booking_opens_at := public.get_reservation_booking_opens_at(
    target_starts_at,
    effective_advance_hours
  );

  if released_permanent_at is not null then
    booking_opens_at := least(booking_opens_at, released_permanent_at);
  end if;

  if now() < booking_opens_at then
    raise exception 'Ce créneau sera réservable à partir du %',
      to_char(
        booking_opens_at at time zone resource_timezone,
        'DD/MM/YYYY à HH24:MI'
      )
      using errcode = 'P0001';
  end if;

  if now() + make_interval(mins => settings.minimum_notice_minutes)
    >= target_starts_at then
    raise exception 'Le délai minimum avant réservation n''est pas respecté'
      using errcode = 'P0001';
  end if;

  if target_user_id is not null then
    select count(*)
    into active_count
    from public.reservations as active_reservation
    join public.reservable_resources as active_resource
      on active_resource.id = active_reservation.resource_id
    where active_reservation.user_id = target_user_id
      and active_reservation.id is distinct from excluded_reservation_id
      and active_reservation.status in ('pending', 'confirmed')
      and active_reservation.ends_at > now()
      and active_resource.club_id = target_club_id;

    if active_count >= effective_max_active then
      raise exception 'Le nombre maximal de réservations actives est atteint'
        using errcode = 'P0001';
    end if;
  end if;

  if exists (
    select 1
    from public.calendar_occupations
    where resource_id = target_resource_id
      and cancelled_at is null
      and (
        excluded_reservation_id is null
        or reservation_id is distinct from excluded_reservation_id
      )
      and tstzrange(starts_at, ends_at, '[)')
        && tstzrange(target_starts_at, target_ends_at, '[)')
  ) then
    raise exception 'Ce créneau est déjà occupé'
      using errcode = '23P01';
  end if;

  return query select terms.customer_type, terms.price_cents;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_my_reservation(target_reservation_id uuid)
 RETURNS TABLE(reservation_id uuid, reservation_status reservation_status, payment_status payment_status, refund_required boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  reservation_row public.reservations;
  cancelled_row public.reservations;
  notice_hours integer;
  requires_refund boolean;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select reservation.*
  into reservation_row
  from public.reservations as reservation
  where reservation.id = target_reservation_id
    and reservation.user_id = actor_id
  for update;

  if reservation_row.id is null then
    raise exception 'Réservation introuvable' using errcode = 'P0002';
  end if;

  if reservation_row.status = 'cancelled' then
    return query
    select reservation_row.id, reservation_row.status, reservation_row.payment_status, false;
    return;
  end if;

  if reservation_row.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut plus être annulée' using errcode = '22023';
  end if;

  select settings.cancellation_notice_hours
  into notice_hours
  from public.reservable_resources as resource
  join public.club_reservation_settings as settings
    on settings.club_id = resource.club_id
  where resource.id = reservation_row.resource_id;
  notice_hours := coalesce(notice_hours, 8);

  if now() > reservation_row.starts_at - make_interval(hours => notice_hours) then
    raise exception 'Le délai d’annulation en ligne est dépassé' using errcode = '22023';
  end if;

  requires_refund := reservation_row.payment_required
    and reservation_row.payment_status = 'paid';

  update public.reservations as reservation
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = actor_id,
      cancellation_reason = 'Annulation en ligne par le réservant',
      updated_at = now(),
      updated_by = actor_id
  where reservation.id = target_reservation_id
  returning reservation.* into cancelled_row;

  update public.calendar_occupations as occupation
  set cancelled_at = coalesce(occupation.cancelled_at, now()),
      updated_at = now(),
      updated_by = actor_id
  where occupation.reservation_id = target_reservation_id
    and occupation.cancelled_at is null;

  update public.payments as payment
  set status = 'cancelled',
      failure_reason = coalesce(payment.failure_reason, 'Réservation annulée avant paiement'),
      updated_at = now()
  where payment.reservation_id = target_reservation_id
    and payment.status in ('pending', 'authorized');

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    target_reservation_id,
    'cancelled_by_customer',
    actor_id,
    to_jsonb(reservation_row),
    to_jsonb(cancelled_row)
  );

  begin
    perform public.publish_released_reservation_slot_notification(target_reservation_id, actor_id);
  exception when others then
    raise warning 'Notification de créneau libéré non publiée pour la réservation %: %', target_reservation_id, sqlerrm;
  end;

  return query
  select cancelled_row.id, cancelled_row.status, cancelled_row.payment_status, requires_refund;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_reservation(target_reservation_id uuid, cancellation_reason text DEFAULT NULL::text)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  existing_reservation public.reservations;
  cancelled_reservation public.reservations;
  notice_hours integer;
  actor_is_admin boolean := false;
  target_club_id uuid;
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

  select resource.club_id
  into target_club_id
  from public.reservable_resources as resource
  where resource.id = existing_reservation.resource_id;

  actor_is_admin := public.has_club_permission(target_club_id, 'reservations.manage');

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
    from public.club_reservation_settings as settings
    where settings.club_id = target_club_id;

    if now() > existing_reservation.starts_at - make_interval(hours => notice_hours) then
      raise exception 'Le délai d’annulation en ligne est dépassé'
        using errcode = '22023';
    end if;
  end if;

  update public.reservations as reservation
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = actor_id,
      cancellation_reason = nullif(btrim(cancel_reservation.cancellation_reason), ''),
      updated_at = now(),
      updated_by = actor_id
  where reservation.id = target_reservation_id
  returning reservation.* into cancelled_reservation;

  update public.calendar_occupations
  set cancelled_at = now(),
      updated_at = now(),
      updated_by = actor_id
  where reservation_id = target_reservation_id
    and cancelled_at is null;

  insert into public.reservation_audit_log (
    reservation_id, action, actor_id, previous_data, new_data
  ) values (
    target_reservation_id, 'cancelled', actor_id,
    to_jsonb(existing_reservation), to_jsonb(cancelled_reservation)
  );

  begin
    perform public.publish_released_reservation_slot_notification(
      target_reservation_id, actor_id
    );
  exception when others then
    raise warning 'Notification de créneau libéré non publiée pour la réservation %: %',
      target_reservation_id, sqlerrm;
  end;

  return cancelled_reservation;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_reservation(target_resource_id uuid, target_starts_at timestamp with time zone, guest_name text DEFAULT NULL::text, guest_email text DEFAULT NULL::text, guest_phone text DEFAULT NULL::text)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.assert_not_championship_only_slot(target_resource_id, target_starts_at);
  if (
    select settings.online_payment_enabled
    from public.reservable_resources as resource
    join public.club_reservation_settings as settings
      on settings.club_id = resource.club_id
    where resource.id = target_resource_id
      and resource.is_active
  ) then
    raise exception 'Le paiement en ligne est activé pour les réservations'
      using errcode = 'P0001';
  end if;

  return public.create_reservation_record(
    target_resource_id,
    target_starts_at,
    guest_name,
    guest_email,
    guest_phone
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_reservation_record(target_resource_id uuid, target_starts_at timestamp with time zone, guest_name text DEFAULT NULL::text, guest_email text DEFAULT NULL::text, guest_phone text DEFAULT NULL::text)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  settings public.club_reservation_settings%rowtype;
  target_ends_at timestamptz;
  terms record;
  created_reservation public.reservations;
begin
  select scoped_settings.*
  into strict settings
  from public.reservable_resources as resource
  join public.club_reservation_settings as scoped_settings
    on scoped_settings.club_id = resource.club_id
  where resource.id = target_resource_id
    and resource.is_active;

  target_ends_at := target_starts_at
    + make_interval(mins => settings.default_duration_minutes);

  if actor_id is null and (
    nullif(btrim(guest_name), '') is null
    or nullif(btrim(guest_email), '') is null
    or nullif(btrim(guest_phone), '') is null
  ) then
    raise exception 'Nom, adresse électronique et téléphone sont obligatoires'
      using errcode = '22023';
  end if;

  select * into strict terms
  from public.assert_reservation_slot_allowed(
    target_resource_id,
    actor_id,
    target_starts_at,
    target_ends_at,
    null
  );

  insert into public.reservations (
    resource_id, user_id, guest_name, guest_email, guest_phone,
    customer_type, status, starts_at, ends_at, price_cents,
    payment_required, created_by, updated_by
  ) values (
    target_resource_id,
    actor_id,
    case when actor_id is null then btrim(guest_name) end,
    case when actor_id is null then lower(btrim(guest_email)) end,
    case when actor_id is null then btrim(guest_phone) end,
    terms.customer_type,
    'confirmed',
    target_starts_at,
    target_ends_at,
    terms.price_cents,
    false,
    actor_id,
    actor_id
  ) returning * into created_reservation;

  insert into public.calendar_occupations (
    resource_id, occupation_type, reservation_id, title,
    starts_at, ends_at, created_by, updated_by
  ) values (
    target_resource_id,
    'reservation',
    created_reservation.id,
    'Réservation',
    target_starts_at,
    target_ends_at,
    actor_id,
    actor_id
  );

  insert into public.reservation_audit_log (
    reservation_id, action, actor_id, new_data
  ) values (
    created_reservation.id,
    'created',
    actor_id,
    to_jsonb(created_reservation)
  );

  return created_reservation;
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d''être réservé par une autre personne'
      using errcode = '23P01';
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_championship_reservation_access(target_resource_id uuid, target_user_id uuid, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone)
 RETURNS TABLE(is_priority boolean, advance_hours integer, max_active_reservations integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_club_id uuid;
  target_timezone text;
  local_start timestamp;
  local_end timestamp;
  step_minutes integer;
  policy public.championship_reservation_settings%rowtype;
begin
  select resource.club_id, resource.timezone
  into target_club_id, target_timezone
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null or target_user_id is null then
    return query select false, null::integer, null::integer;
    return;
  end if;

  select *
  into policy
  from public.championship_reservation_settings as setting
  where setting.club_id = target_club_id
    and setting.enabled;

  if policy.club_id is null
    or not exists (
      select 1
      from public.championship_reservation_resources as selected_resource
      where selected_resource.club_id = target_club_id
        and selected_resource.resource_id = target_resource_id
    )
    or not public.championship_reservation_player_is_eligible(
      target_club_id,
      target_user_id
    )
  then
    return query select false, null::integer, null::integer;
    return;
  end if;

  local_start := target_starts_at at time zone target_timezone;
  local_end := target_ends_at at time zone target_timezone;

  if local_start::date <> local_end::date then
    return query select false, null::integer, null::integer;
    return;
  end if;

  select settings.booking_step_minutes
  into step_minutes
  from public.club_reservation_settings as settings
  where settings.club_id = target_club_id;

  if not exists (
    select 1
    from public.championship_reservation_windows as priority_window
    where priority_window.club_id = target_club_id
      and priority_window.weekday = extract(isodow from local_start)::smallint
      and priority_window.opens_at <= local_start::time
      and priority_window.closes_at >= local_end::time
      and mod(
        extract(epoch from (local_start::time - priority_window.opens_at))::bigint,
        step_minutes::bigint * 60
      ) = 0
  ) then
    return query select false, null::integer, null::integer;
    return;
  end if;

  return query select
    true,
    policy.advance_days * 24,
    policy.max_active_reservations;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_available_slots(target_resource_id uuid, range_start date, range_end date)
 RETURNS TABLE(resource_id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, booking_opens_at timestamp with time zone, booked_by_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with resource_config as (
    select
      resource.id,
      resource.club_id,
      resource.timezone,
      settings.default_duration_minutes,
      settings.booking_step_minutes
    from public.reservable_resources as resource
    join public.club_reservation_settings as settings
      on settings.club_id = resource.club_id
    where resource.id = target_resource_id
      and resource.is_active
  ),
  calendar_days as (
    select day_value::date as calendar_date
    from generate_series(range_start, range_end, interval '1 day') as day_value
  ),
  regular_periods as (
    select
      config.id as resource_id,
      config.timezone,
      config.default_duration_minutes,
      config.booking_step_minutes,
      day.calendar_date,
      hours.opens_at,
      hours.closes_at
    from resource_config as config
    cross join calendar_days as day
    join public.resource_opening_hours as hours
      on hours.resource_id = config.id
     and hours.weekday = extract(dow from day.calendar_date)::smallint
     and hours.is_open
  ),
  championship_periods as (
    select
      config.id as resource_id,
      config.timezone,
      config.default_duration_minutes,
      config.booking_step_minutes,
      day.calendar_date,
      priority_window.opens_at,
      priority_window.closes_at
    from resource_config as config
    cross join calendar_days as day
    join public.championship_reservation_settings as policy
      on policy.club_id = config.club_id
     and policy.enabled
    join public.championship_reservation_resources as selected_resource
      on selected_resource.club_id = config.club_id
     and selected_resource.resource_id = config.id
    join public.championship_reservation_windows as priority_window
      on priority_window.club_id = config.club_id
     and priority_window.weekday = extract(isodow from day.calendar_date)::smallint
    where public.championship_reservation_player_is_eligible(
      config.club_id,
      auth.uid()
    )
  ),
  opening_periods as (
    select * from regular_periods
    union
    select * from championship_periods
  ),
  generated_slots as (
    select distinct
      period.resource_id,
      (slot_local at time zone period.timezone) as starts_at,
      (
        slot_local + make_interval(mins => period.default_duration_minutes)
      ) at time zone period.timezone as ends_at
    from opening_periods as period
    cross join lateral generate_series(
      period.calendar_date + period.opens_at,
      period.calendar_date + period.closes_at
        - make_interval(mins => period.default_duration_minutes),
      make_interval(mins => period.booking_step_minutes)
    ) as slot_local
  ),
  slots_with_terms as (
    select
      slot.*,
      public.get_reservation_booking_opens_at(
        slot.starts_at,
        coalesce(access.advance_hours, terms.advance_hours)
      ) as booking_opens_at
    from generated_slots as slot
    cross join lateral public.get_reservation_terms_for_resource(
      slot.resource_id,
      auth.uid(),
      slot.starts_at
    ) as terms
    cross join lateral public.get_championship_reservation_access(
      slot.resource_id,
      auth.uid(),
      slot.starts_at,
      slot.ends_at
    ) as access
  ),
  scheduled_slots as (
    select
      slot.resource_id,
      slot.starts_at,
      slot.ends_at,
      case
        when occupation.id is not null then 'occupied'
        when now() < slot.booking_opens_at then 'locked'
        else 'available'
      end as status,
      slot.booking_opens_at,
      case
        when occupation.occupation_type = 'reservation'::public.occupation_type then
          coalesce(
            nullif(btrim(concat_ws(' ', club_member.first_name, club_member.last_name)), ''),
            nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
            nullif(btrim(profile.display_name), ''),
            nullif(btrim(reservation.guest_name), ''),
            'Réservation'
          )
        when occupation.id is not null then
          coalesce(nullif(btrim(occupation.title), ''), 'Indisponibilité exceptionnelle')
        else null
      end as booked_by_name
    from slots_with_terms as slot
    join public.reservable_resources as slot_resource
      on slot_resource.id = slot.resource_id
    left join public.calendar_occupations as occupation
      on occupation.resource_id = slot.resource_id
     and occupation.cancelled_at is null
     and occupation.starts_at = slot.starts_at
     and occupation.ends_at = slot.ends_at
    left join public.reservations as reservation on reservation.id = occupation.reservation_id
    left join public.profiles as profile on profile.id = reservation.user_id
    left join public.club_members as club_member on club_member.id = public.profile_club_member_id(profile.id, slot_resource.club_id)
    where not exists (
      select 1
      from public.calendar_occupations as overlapping_occupation
      where overlapping_occupation.resource_id = slot.resource_id
        and overlapping_occupation.cancelled_at is null
        and overlapping_occupation.starts_at < slot.ends_at
        and overlapping_occupation.ends_at > slot.starts_at
        and not (
          overlapping_occupation.starts_at = slot.starts_at
          and overlapping_occupation.ends_at = slot.ends_at
        )
    )
  ),
  occupations_outside_schedule as (
    select
      occupation.resource_id,
      occupation.starts_at,
      occupation.ends_at,
      'occupied'::text as status,
      null::timestamptz as booking_opens_at,
      case
        when occupation.occupation_type = 'reservation'::public.occupation_type then
          coalesce(
            nullif(btrim(concat_ws(' ', club_member.first_name, club_member.last_name)), ''),
            nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
            nullif(btrim(profile.display_name), ''),
            nullif(btrim(reservation.guest_name), ''),
            'Réservation'
          )
        else coalesce(nullif(btrim(occupation.title), ''), 'Indisponibilité exceptionnelle')
      end as booked_by_name
    from public.calendar_occupations as occupation
    join public.reservable_resources as resource
      on resource.id = occupation.resource_id
     and resource.is_active
    left join public.reservations as reservation on reservation.id = occupation.reservation_id
    left join public.profiles as profile on profile.id = reservation.user_id
    left join public.club_members as club_member on club_member.id = public.profile_club_member_id(profile.id, resource.club_id)
    where occupation.resource_id = target_resource_id
      and occupation.cancelled_at is null
      and (occupation.starts_at at time zone resource.timezone)::date <= range_end
      and (occupation.ends_at at time zone resource.timezone)::date >= range_start
      and not exists (
        select 1
        from generated_slots as slot
        where slot.resource_id = occupation.resource_id
          and slot.starts_at = occupation.starts_at
          and slot.ends_at = occupation.ends_at
      )
  )
  select * from scheduled_slots
  union all
  select * from occupations_outside_schedule
  order by starts_at;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_reservations()
 RETURNS TABLE(id uuid, resource_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, reservation_status reservation_status, payment_status payment_status, payment_required boolean, amount_cents integer, currency text, payment_id uuid, payment_expires_at timestamp with time zone, payment_redirect_url text, cancellation_deadline timestamp with time zone, can_cancel boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  join public.club_reservation_settings as settings
    on settings.club_id = resource.club_id
  left join lateral (
    select candidate.id, candidate.expires_at, candidate.redirect_url
    from public.payments as candidate
    where candidate.reservation_id = reservation.id
      and (
        candidate.payer_profile_id = auth.uid()
        or (
          candidate.payer_profile_id is null
          and reservation.user_id = auth.uid()
        )
      )
    order by candidate.created_at desc
    limit 1
  ) as payment on true
  where auth.uid() is not null
    and reservation.user_id = auth.uid()
  order by reservation.starts_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.modify_reservation(target_reservation_id uuid, target_resource_id uuid, target_starts_at timestamp with time zone)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  existing_reservation public.reservations;
  settings public.club_reservation_settings%rowtype;
  target_club_id uuid;
  target_ends_at timestamptz;
  terms record;
  changed_reservation public.reservations;
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

  select resource.club_id
  into target_club_id
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null then
    raise exception 'Ressource introuvable' using errcode = 'P0002';
  end if;

  if existing_reservation.user_id is distinct from actor_id
    and not public.has_club_permission(target_club_id, 'reservations.manage') then
    raise exception 'Modification interdite' using errcode = '42501';
  end if;

  if existing_reservation.status not in ('pending', 'confirmed') then
    raise exception 'Cette réservation ne peut plus être modifiée'
      using errcode = 'P0001';
  end if;

  select *
  into strict settings
  from public.club_reservation_settings
  where club_id = target_club_id;

  target_ends_at := target_starts_at
    + make_interval(mins => settings.default_duration_minutes);

  select *
  into strict terms
  from public.assert_reservation_slot_allowed(
    target_resource_id,
    existing_reservation.user_id,
    target_starts_at,
    target_ends_at,
    target_reservation_id
  );

  update public.reservations
  set resource_id = target_resource_id,
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      customer_type = terms.customer_type,
      price_cents = terms.price_cents,
      updated_at = now(),
      updated_by = actor_id
  where id = target_reservation_id
  returning * into changed_reservation;

  update public.calendar_occupations
  set resource_id = target_resource_id,
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      updated_at = now(),
      updated_by = actor_id
  where reservation_id = target_reservation_id;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    target_reservation_id,
    'modified',
    actor_id,
    to_jsonb(existing_reservation),
    to_jsonb(changed_reservation)
  );

  return changed_reservation;
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d''être réservé par une autre personne'
      using errcode = '23P01';
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_for_payment(target_resource_id uuid, target_starts_at timestamp with time zone, guest_name text DEFAULT NULL::text, guest_email text DEFAULT NULL::text, guest_phone text DEFAULT NULL::text)
 RETURNS TABLE(reservation_id uuid, payment_id uuid, amount_cents integer, currency text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  created_reservation public.reservations;
  created_payment public.payments;
begin
  perform public.assert_not_championship_only_slot(target_resource_id, target_starts_at);
  if not (
    select settings.online_payment_enabled
    from public.reservable_resources as resource
    join public.club_reservation_settings as settings
      on settings.club_id = resource.club_id
    where resource.id = target_resource_id
      and resource.is_active
  ) then
    raise exception 'Le paiement en ligne est désactivé' using errcode = 'P0001';
  end if;

  created_reservation := public.create_reservation_record(
    target_resource_id,
    target_starts_at,
    guest_name,
    guest_email,
    guest_phone
  );

  update public.reservations
  set status = 'pending',
      payment_required = true,
      payment_status = 'pending',
      payment_plan = 'full',
      updated_at = now(),
      updated_by = auth.uid()
  where id = created_reservation.id
  returning * into created_reservation;

  insert into public.payments (
    reservation_id,
    payer_profile_id,
    amount_cents,
    currency,
    metadata
  ) values (
    created_reservation.id,
    auth.uid(),
    created_reservation.price_cents,
    created_reservation.currency,
    jsonb_build_object(
      'reservation_id', created_reservation.id,
      'payment_plan', 'full'
    )
  ) returning * into created_payment;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    new_data
  ) values (
    created_reservation.id,
    'payment_started',
    auth.uid(),
    jsonb_build_object('payment_id', created_payment.id, 'payment_plan', 'full')
  );

  return query select
    created_reservation.id,
    created_payment.id,
    created_payment.amount_cents,
    created_payment.currency,
    created_payment.expires_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_for_split_payment(target_resource_id uuid, target_starts_at timestamp with time zone, partner_profile_ids uuid[])
 RETURNS TABLE(reservation_id uuid, payment_id uuid, amount_cents integer, currency text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor_id uuid:=auth.uid(); target_club_id uuid; eligible_count integer; online_payment_enabled boolean; created_reservation public.reservations; created_payment public.payments; partner_id uuid; partner_payment public.payments; split_payment_timeout integer; common_expires_at timestamptz; partner_amount integer; actor_amount integer;
begin
 perform public.assert_not_championship_only_slot(target_resource_id,target_starts_at);
 if actor_id is null then raise exception 'Connexion requise' using errcode='42501'; end if;
 select resource.club_id into target_club_id from public.reservable_resources resource where resource.id=target_resource_id and resource.is_active;
 if target_club_id is null then raise exception 'Terrain introuvable' using errcode='P0002'; end if;
 select settings.online_payment_enabled, settings.split_payment_timeout_minutes
 into strict online_payment_enabled, split_payment_timeout
 from public.club_reservation_settings settings
 where settings.club_id=target_club_id;
 if not online_payment_enabled then raise exception 'Le paiement en ligne est désactivé' using errcode='P0001'; end if;
 common_expires_at:=now()+make_interval(mins=>split_payment_timeout);
 if coalesce(array_length(partner_profile_ids,1),0)<>3 or (select count(distinct candidate) from unnest(partner_profile_ids) candidate)<>3 or actor_id=any(partner_profile_ids) then raise exception 'Sélectionnez exactement trois autres joueurs' using errcode='22023'; end if;
 select count(*) into eligible_count from public.profiles profile where profile.id=any(partner_profile_ids) and public.profile_club_member_id(profile.id,target_club_id) is not null;
 if eligible_count<>3 then raise exception 'Les joueurs sélectionnés doivent posséder un compte PILOTOKI actif dans ce club' using errcode='22023'; end if;
 created_reservation:=public.create_reservation_record(target_resource_id,target_starts_at,null,null,null);
 update public.reservations set status='pending',payment_required=true,payment_status='pending',payment_plan='split',updated_at=now(),updated_by=actor_id where id=created_reservation.id returning * into created_reservation;
 partner_amount:=created_reservation.price_cents/4; actor_amount:=created_reservation.price_cents-(partner_amount*3);
 insert into public.payments(reservation_id,payer_profile_id,amount_cents,currency,expires_at,metadata) values(created_reservation.id,actor_id,actor_amount,created_reservation.currency,common_expires_at,jsonb_build_object('reservation_id',created_reservation.id,'payment_plan','split','share',1,'share_count',4)) returning * into created_payment;
 for partner_id in select candidate from unnest(partner_profile_ids) candidate loop
  insert into public.payments(reservation_id,payer_profile_id,amount_cents,currency,expires_at,metadata) values(created_reservation.id,partner_id,partner_amount,created_reservation.currency,common_expires_at,jsonb_build_object('reservation_id',created_reservation.id,'payment_plan','split','share_count',4)) returning * into partner_payment;
  perform public.publish_reservation_share_payment_request(partner_payment.id);
 end loop;
 insert into public.reservation_audit_log(reservation_id,action,actor_id,new_data) values(created_reservation.id,'split_payment_started',actor_id,jsonb_build_object('owner_payment_id',created_payment.id,'partner_profile_ids',to_jsonb(partner_profile_ids),'share_count',4,'payment_timeout_minutes',split_payment_timeout,'expires_at',common_expires_at));
 return query select created_reservation.id,created_payment.id,created_payment.amount_cents,created_payment.currency,created_payment.expires_at;
end;$function$;

commit;
