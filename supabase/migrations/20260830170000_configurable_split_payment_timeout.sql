begin;

alter table public.reservation_settings
add column if not exists split_payment_timeout_minutes integer not null default 45;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reservation_settings_split_payment_timeout_positive'
      and conrelid = 'public.reservation_settings'::regclass
  ) then
    alter table public.reservation_settings
    add constraint reservation_settings_split_payment_timeout_positive
    check (split_payment_timeout_minutes > 0);
  end if;
end;
$$;

drop function if exists public.admin_get_reservation_settings();

create function public.admin_get_reservation_settings()
returns table (
  licensee_advance_hours integer,
  public_advance_hours integer,
  licensee_price_cents integer,
  public_price_cents integer,
  default_duration_minutes integer,
  booking_step_minutes integer,
  minimum_notice_minutes integer,
  cancellation_notice_hours integer,
  licensee_max_active_reservations integer,
  public_max_active_reservations integer,
  online_payment_enabled boolean,
  payment_mode text,
  split_payment_timeout_minutes integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  return query
  select
    settings.licensee_advance_hours,
    settings.public_advance_hours,
    settings.licensee_price_cents,
    settings.public_price_cents,
    settings.default_duration_minutes,
    settings.booking_step_minutes,
    settings.minimum_notice_minutes,
    settings.cancellation_notice_hours,
    settings.licensee_max_active_reservations,
    settings.public_max_active_reservations,
    settings.online_payment_enabled,
    settings.payment_mode,
    settings.split_payment_timeout_minutes
  from public.reservation_settings as settings
  where settings.id;
end;
$$;

revoke all on function public.admin_get_reservation_settings() from public;
grant execute on function public.admin_get_reservation_settings() to authenticated;

drop function if exists public.admin_update_reservation_settings(
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, boolean, text
);

drop function if exists public.admin_update_reservation_settings(
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, boolean, text, integer
);

create function public.admin_update_reservation_settings(
  new_licensee_advance_hours integer,
  new_public_advance_hours integer,
  new_licensee_price_cents integer,
  new_public_price_cents integer,
  new_default_duration_minutes integer,
  new_booking_step_minutes integer,
  new_minimum_notice_minutes integer,
  new_cancellation_notice_hours integer,
  new_licensee_max_active_reservations integer,
  new_public_max_active_reservations integer,
  new_online_payment_enabled boolean,
  new_payment_mode text,
  new_split_payment_timeout_minutes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if new_licensee_advance_hours < 0
    or new_public_advance_hours < 0
    or new_licensee_price_cents < 0
    or new_public_price_cents < 0
    or new_default_duration_minutes <= 0
    or new_booking_step_minutes <= 0
    or new_minimum_notice_minutes < 0
    or new_cancellation_notice_hours < 0
    or new_licensee_max_active_reservations <= 0
    or new_public_max_active_reservations <= 0
    or new_payment_mode not in ('test', 'helloasso')
    or new_split_payment_timeout_minutes <= 0 then
    raise exception 'Les paramètres de réservation sont invalides'
      using errcode = '22023';
  end if;

  update public.reservation_settings
  set licensee_advance_hours = new_licensee_advance_hours,
      public_advance_hours = new_public_advance_hours,
      licensee_price_cents = new_licensee_price_cents,
      public_price_cents = new_public_price_cents,
      default_duration_minutes = new_default_duration_minutes,
      booking_step_minutes = new_booking_step_minutes,
      minimum_notice_minutes = new_minimum_notice_minutes,
      cancellation_notice_hours = new_cancellation_notice_hours,
      licensee_max_active_reservations = new_licensee_max_active_reservations,
      public_max_active_reservations = new_public_max_active_reservations,
      online_payment_enabled = new_online_payment_enabled,
      payment_mode = new_payment_mode,
      split_payment_timeout_minutes = new_split_payment_timeout_minutes,
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

revoke all on function public.admin_update_reservation_settings(
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, boolean, text, integer
) from public;
grant execute on function public.admin_update_reservation_settings(
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, boolean, text, integer
) to authenticated;

create or replace function public.reserve_for_split_payment(
  target_resource_id uuid,
  target_starts_at timestamptz,
  partner_profile_ids uuid[]
)
returns table (
  reservation_id uuid,
  payment_id uuid,
  amount_cents integer,
  currency text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
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
  join public.club_members as member
    on member.id = profile.member_id
   and member.club_id = target_club_id
   and member.is_active
  where profile.id = any(partner_profile_ids);

  if eligible_count <> 3 then
    raise exception 'Les joueurs sélectionnés doivent posséder un compte Pelote Manager actif dans ce club'
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
$$;

revoke all on function public.reserve_for_split_payment(uuid, timestamptz, uuid[])
from public, anon, authenticated;
grant execute on function public.reserve_for_split_payment(uuid, timestamptz, uuid[])
to authenticated;

commit;
