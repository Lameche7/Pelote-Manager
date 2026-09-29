begin;

CREATE OR REPLACE FUNCTION public.reserve_for_split_payment(target_resource_id uuid, target_starts_at timestamp with time zone, partner_profile_ids uuid[])
 RETURNS TABLE(reservation_id uuid, payment_id uuid, amount_cents integer, currency text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
  eligible_count integer;
  created_reservation public.reservations;
  created_payment public.payments;
  partner_id uuid;
  partner_payment public.payments;
  split_payment_timeout integer;
  common_expires_at timestamptz;
  partner_amount integer;
  actor_amount integer;
begin
  perform public.assert_not_championship_only_slot(target_resource_id, target_starts_at);
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  if not (select online_payment_enabled from public.reservation_settings where id) then
    raise exception 'Le paiement en ligne est désactivé' using errcode = 'P0001';
  end if;

  select settings.split_payment_timeout_minutes
  into strict split_payment_timeout
  from public.reservation_settings as settings
  where settings.id;

  common_expires_at := now() + make_interval(mins => split_payment_timeout);

  if coalesce(array_length(partner_profile_ids, 1), 0) <> 3
    or (
      select count(distinct candidate)
      from unnest(partner_profile_ids) as candidate
    ) <> 3
    or actor_id = any(partner_profile_ids)
  then
    raise exception 'Sélectionnez exactement trois autres joueurs'
      using errcode = '22023';
  end if;

  select resource.club_id
  into target_club_id
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null then
    raise exception 'Terrain introuvable' using errcode = 'P0002';
  end if;

  select count(*)
  into eligible_count
  from public.profiles as profile
  where profile.id = any(partner_profile_ids)
    and public.profile_club_member_id(profile.id, target_club_id) is not null;

  if eligible_count <> 3 then
    raise exception 'Les joueurs sélectionnés doivent posséder un compte PILOTOKI actif dans ce club'
      using errcode = '22023';
  end if;

  created_reservation := public.create_reservation_record(
    target_resource_id,
    target_starts_at,
    null,
    null,
    null
  );

  update public.reservations
  set status = 'pending',
      payment_required = true,
      payment_status = 'pending',
      payment_plan = 'split',
      updated_at = now(),
      updated_by = actor_id
  where id = created_reservation.id
  returning * into created_reservation;

  partner_amount := created_reservation.price_cents / 4;
  actor_amount := created_reservation.price_cents - (partner_amount * 3);

  insert into public.payments (
    reservation_id,
    payer_profile_id,
    amount_cents,
    currency,
    expires_at,
    metadata
  ) values (
    created_reservation.id,
    actor_id,
    actor_amount,
    created_reservation.currency,
    common_expires_at,
    jsonb_build_object(
      'reservation_id', created_reservation.id,
      'payment_plan', 'split',
      'share', 1,
      'share_count', 4
    )
  ) returning * into created_payment;

  for partner_id in
    select candidate
    from unnest(partner_profile_ids) as candidate
  loop
    insert into public.payments (
      reservation_id,
      payer_profile_id,
      amount_cents,
      currency,
      expires_at,
      metadata
    ) values (
      created_reservation.id,
      partner_id,
      partner_amount,
      created_reservation.currency,
      common_expires_at,
      jsonb_build_object(
        'reservation_id', created_reservation.id,
        'payment_plan', 'split',
        'share_count', 4
      )
    ) returning * into partner_payment;

    perform public.publish_reservation_share_payment_request(partner_payment.id);
  end loop;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    new_data
  ) values (
    created_reservation.id,
    'split_payment_started',
    actor_id,
    jsonb_build_object(
      'owner_payment_id', created_payment.id,
      'partner_profile_ids', to_jsonb(partner_profile_ids),
      'share_count', 4,
      'payment_timeout_minutes', split_payment_timeout,
      'expires_at', common_expires_at
    )
  );

  return query select
    created_reservation.id,
    created_payment.id,
    created_payment.amount_cents,
    created_payment.currency,
    created_payment.expires_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.search_reservation_payment_players(target_resource_id uuid, search_text text DEFAULT ''::text)
 RETURNS TABLE(profile_id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
  needle text := btrim(coalesce(search_text, ''));
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select resource.club_id
  into target_club_id
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.is_active;

  if target_club_id is null then
    raise exception 'Terrain introuvable' using errcode = 'P0002';
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
      'Joueur'
    )
  from public.club_members as member
  join public.profiles as profile
    on profile.id = public.club_member_profile_id(member.id)
  where member.club_id = target_club_id
    and member.is_active
    and profile.id <> actor_id
    and (
      needle = ''
      or member.first_name_normalized like '%' || public.normalize_member_identity(needle) || '%'
      or member.last_name_normalized like '%' || public.normalize_member_identity(needle) || '%'
      or lower(coalesce(profile.display_name, '')) like '%' || lower(needle) || '%'
    )
  order by member.last_name_normalized, member.first_name_normalized, profile.id
  limit 30;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_reservation_share_payment_request(target_payment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target record;
  saved_communication_id uuid;
begin
  select
    payment.id as payment_id,
    payment.amount_cents,
    payment.expires_at,
    payment.payer_profile_id,
    reservation.id as reservation_id,
    reservation.user_id as booker_profile_id,
    reservation.starts_at,
    resource.club_id,
    resource.name as resource_name,
    resource.timezone,
    payer_member.id as payer_member_id,
    payer_profile.email as payer_email,
    coalesce(
      nullif(btrim(booker_profile.display_name), ''),
      nullif(btrim(concat_ws(' ', booker_profile.first_name, booker_profile.last_name)), ''),
      'Un joueur'
    ) as booker_name
  into target
  from public.payments as payment
  join public.reservations as reservation on reservation.id = payment.reservation_id
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  join public.profiles as payer_profile on payer_profile.id = payment.payer_profile_id
  join public.club_members as payer_member
    on payer_member.id = public.profile_club_member_id(payer_profile.id, resource.club_id)
  left join public.profiles as booker_profile on booker_profile.id = reservation.user_id
  where payment.id = target_payment_id
    and reservation.payment_plan = 'split';

  if target.payment_id is null then
    raise exception 'Part de paiement introuvable' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.reservation_payment_notification_events as event
    where event.payment_id = target.payment_id
  ) then
    select event.communication_id
    into saved_communication_id
    from public.reservation_payment_notification_events as event
    where event.payment_id = target.payment_id;
    return saved_communication_id;
  end if;

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
    target.club_id,
    'Paiement d’une réservation',
    concat(
      target.booker_name,
      ' vous a ajouté à une réservation de ', target.resource_name,
      ' le ', to_char(target.starts_at at time zone target.timezone, 'DD/MM/YYYY'),
      ' à ', to_char(target.starts_at at time zone target.timezone, 'HH24:MI'),
      '. Votre part est de ',
      trim(to_char(target.amount_cents / 100.0, 'FM999999990D00')),
      ' €. Ouvrez cette notification pour la régler.'
    ),
    'important',
    'published',
    false,
    now(),
    target.expires_at,
    target.booker_profile_id,
    target.booker_profile_id
  )
  returning id into saved_communication_id;

  insert into public.communication_deliveries (
    communication_id,
    club_id,
    club_member_id,
    profile_id_at_publication,
    email_snapshot,
    email_status
  ) values (
    saved_communication_id,
    target.club_id,
    target.payer_member_id,
    target.payer_profile_id,
    nullif(btrim(target.payer_email), ''),
    case
      when nullif(btrim(target.payer_email), '') is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  );

  insert into public.reservation_payment_notification_events (
    payment_id,
    communication_id
  ) values (
    target.payment_id,
    saved_communication_id
  );

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  ) values (
    target.club_id,
    saved_communication_id,
    'published',
    target.booker_profile_id,
    jsonb_build_object(
      'source', 'reservation_split_payment',
      'reservation_id', target.reservation_id,
      'payment_id', target.payment_id,
      'payer_profile_id', target.payer_profile_id
    )
  );

  return saved_communication_id;
end;
$function$
;

commit;
