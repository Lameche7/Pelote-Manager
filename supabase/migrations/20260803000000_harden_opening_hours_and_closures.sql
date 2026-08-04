-- Horaires de réservation administrables par terrain.
-- Le club utilise des créneaux fixes de 60 minutes.
update public.reservation_settings
set default_duration_minutes = 60,
    booking_step_minutes = 60,
    updated_at = now()
where id;

-- Toutes les commandes d'administration restent cloisonnées au club du terrain.
create or replace function public.assert_reservations_manage_resource(
  target_resource_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  resource_active boolean;
begin
  select resource.club_id, resource.is_active
  into target_club_id, resource_active
  from public.reservable_resources as resource
  where resource.id = target_resource_id;

  if target_club_id is null or resource_active is distinct from true then
    raise exception 'Terrain introuvable ou inactif' using errcode = 'P0002';
  end if;

  if not public.has_club_permission(
    target_club_id,
    'reservations.manage'
  ) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  return target_club_id;
end;
$$;

create or replace function public.admin_list_opening_hours(target_resource_id uuid)
returns table (
  id bigint,
  resource_id uuid,
  weekday smallint,
  opens_at time,
  closes_at time,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_reservations_manage_resource(target_resource_id);

  return query
  select
    hours.id,
    hours.resource_id,
    case when hours.weekday = 0 then 7 else hours.weekday end::smallint,
    hours.opens_at,
    hours.closes_at,
    hours.is_open
  from public.resource_opening_hours as hours
  where hours.resource_id = target_resource_id
  order by case when hours.weekday = 0 then 7 else hours.weekday end,
    hours.opens_at;
end;
$$;

create or replace function public.admin_save_opening_hour(
  target_id bigint,
  target_resource_id uuid,
  target_weekday smallint,
  target_opens_at time,
  target_closes_at time,
  target_is_active boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id bigint;
  database_weekday smallint;
begin
  perform public.assert_reservations_manage_resource(target_resource_id);

  if target_weekday not between 1 and 7
    or target_closes_at <= target_opens_at then
    raise exception 'Horaire invalide' using errcode = '22023';
  end if;

  database_weekday := case when target_weekday = 7 then 0 else target_weekday end;

  if target_is_active and exists (
    select 1
    from public.resource_opening_hours as hours
    where hours.resource_id = target_resource_id
      and hours.weekday = database_weekday
      and hours.is_open
      and hours.id is distinct from target_id
      and hours.opens_at < target_closes_at
      and hours.closes_at > target_opens_at
  ) then
    raise exception 'Cette plage chevauche un horaire existant'
      using errcode = '23P01';
  end if;

  if target_id is null then
    insert into public.resource_opening_hours (
      resource_id,
      weekday,
      opens_at,
      closes_at,
      is_open
    ) values (
      target_resource_id,
      database_weekday,
      target_opens_at,
      target_closes_at,
      target_is_active
    )
    returning id into saved_id;
  else
    update public.resource_opening_hours
    set weekday = database_weekday,
        opens_at = target_opens_at,
        closes_at = target_closes_at,
        is_open = target_is_active,
        updated_at = now()
    where id = target_id
      and resource_id = target_resource_id
    returning id into saved_id;

    if saved_id is null then
      raise exception 'Horaire introuvable' using errcode = 'P0002';
    end if;
  end if;

  return saved_id;
end;
$$;

create or replace function public.admin_delete_opening_hour(target_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_resource_id uuid;
begin
  select hours.resource_id
  into target_resource_id
  from public.resource_opening_hours as hours
  where hours.id = target_id;

  if target_resource_id is null then
    raise exception 'Horaire introuvable' using errcode = 'P0002';
  end if;

  perform public.assert_reservations_manage_resource(target_resource_id);

  delete from public.resource_opening_hours
  where id = target_id
    and resource_id = target_resource_id;
end;
$$;

-- RPC utilisées par l'onglet Fermetures.
create or replace function public.admin_list_calendar_closures(target_resource_id uuid)
returns table (
  id uuid,
  resource_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_reservations_manage_resource(target_resource_id);

  return query
  select
    occupation.id,
    occupation.resource_id,
    occupation.title,
    occupation.starts_at,
    occupation.ends_at
  from public.calendar_occupations as occupation
  where occupation.resource_id = target_resource_id
    and occupation.occupation_type = 'closure'
    and occupation.cancelled_at is null
  order by occupation.starts_at desc;
end;
$$;

create or replace function public.admin_create_calendar_closure(
  target_resource_id uuid,
  target_title text,
  target_starts_at timestamptz,
  target_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
begin
  perform public.assert_reservations_manage_resource(target_resource_id);

  if nullif(btrim(target_title), '') is null
    or target_ends_at <= target_starts_at then
    raise exception 'Fermeture invalide' using errcode = '22023';
  end if;

  insert into public.calendar_occupations (
    resource_id,
    occupation_type,
    title,
    starts_at,
    ends_at,
    created_by,
    updated_by
  ) values (
    target_resource_id,
    'closure',
    btrim(target_title),
    target_starts_at,
    target_ends_at,
    auth.uid(),
    auth.uid()
  )
  returning id into created_id;

  return created_id;
exception
  when exclusion_violation then
    raise exception 'Cette fermeture chevauche une occupation existante'
      using errcode = '23P01';
end;
$$;

create or replace function public.admin_update_calendar_closure(
  target_id uuid,
  target_title text,
  target_starts_at timestamptz,
  target_ends_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_resource_id uuid;
begin
  select occupation.resource_id
  into target_resource_id
  from public.calendar_occupations as occupation
  where occupation.id = target_id
    and occupation.occupation_type = 'closure'
    and occupation.cancelled_at is null;

  if target_resource_id is null then
    raise exception 'Fermeture introuvable' using errcode = 'P0002';
  end if;

  perform public.assert_reservations_manage_resource(target_resource_id);

  if nullif(btrim(target_title), '') is null
    or target_ends_at <= target_starts_at then
    raise exception 'Fermeture invalide' using errcode = '22023';
  end if;

  update public.calendar_occupations
  set title = btrim(target_title),
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_id
    and resource_id = target_resource_id
    and occupation_type = 'closure'
    and cancelled_at is null;

  if not found then
    raise exception 'Fermeture introuvable' using errcode = 'P0002';
  end if;
exception
  when exclusion_violation then
    raise exception 'Cette fermeture chevauche une occupation existante'
      using errcode = '23P01';
end;
$$;

create or replace function public.admin_delete_calendar_closure(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_resource_id uuid;
begin
  select occupation.resource_id
  into target_resource_id
  from public.calendar_occupations as occupation
  where occupation.id = target_id
    and occupation.occupation_type = 'closure'
    and occupation.cancelled_at is null;

  if target_resource_id is null then
    raise exception 'Fermeture introuvable' using errcode = 'P0002';
  end if;

  perform public.assert_reservations_manage_resource(target_resource_id);

  update public.calendar_occupations
  set cancelled_at = now(),
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_id
    and resource_id = target_resource_id
    and occupation_type = 'closure'
    and cancelled_at is null;

  if not found then
    raise exception 'Fermeture introuvable' using errcode = 'P0002';
  end if;
end;
$$;

-- La commande serveur vérifie les horaires, même en cas d'appel détourné.
create or replace function public.assert_reservation_slot_allowed(
  target_resource_id uuid,
  target_user_id uuid,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  excluded_reservation_id uuid default null
)
returns table (
  customer_type public.reservation_customer_type,
  price_cents integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_active boolean;
  resource_timezone text;
  settings public.reservation_settings%rowtype;
  terms record;
  active_count integer;
  booking_opens_at timestamptz;
  local_start timestamp;
  local_end timestamp;
begin
  if target_ends_at <= target_starts_at then
    raise exception 'La fin du créneau doit être postérieure au début'
      using errcode = '22007';
  end if;

  select is_active, timezone
  into resource_active, resource_timezone
  from public.reservable_resources
  where id = target_resource_id;

  if resource_active is distinct from true then
    raise exception 'La ressource demandée est indisponible'
      using errcode = 'P0001';
  end if;

  select *
  into strict settings
  from public.reservation_settings
  where id;

  if extract(epoch from (target_ends_at - target_starts_at))::integer / 60
    <> settings.default_duration_minutes then
    raise exception 'La durée du créneau ne respecte pas la durée configurée'
      using errcode = 'P0001';
  end if;

  local_start := target_starts_at at time zone resource_timezone;
  local_end := target_ends_at at time zone resource_timezone;

  if local_start::date <> local_end::date
    or not exists (
      select 1
      from public.resource_opening_hours as hours
      where hours.resource_id = target_resource_id
        and hours.weekday = extract(dow from local_start)::smallint
        and hours.is_open
        and hours.opens_at <= local_start::time
        and hours.closes_at >= local_end::time
        and mod(
          extract(
            epoch from (local_start::time - hours.opens_at)
          )::bigint,
          settings.booking_step_minutes::bigint * 60
        ) = 0
    ) then
    raise exception 'Ce créneau se situe hors des horaires de réservation'
      using errcode = 'P0001';
  end if;

  select *
  into strict terms
  from public.get_reservation_terms(target_user_id, target_starts_at);

  booking_opens_at := public.get_reservation_booking_opens_at(
    target_starts_at,
    terms.advance_hours
  );

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
    from public.reservations
    where user_id = target_user_id
      and id is distinct from excluded_reservation_id
      and status in ('pending', 'confirmed')
      and ends_at > now();

    if active_count >= terms.max_active_reservations then
      raise exception 'Le nombre maximal de réservations actives est atteint'
        using errcode = 'P0001';
    end if;
  end if;

  if exists (
    select 1
    from public.calendar_occupations
    where resource_id = target_resource_id
      and cancelled_at is null
      and reservation_id is distinct from excluded_reservation_id
      and tstzrange(starts_at, ends_at, '[)')
        && tstzrange(target_starts_at, target_ends_at, '[)')
  ) then
    raise exception 'Ce créneau est déjà occupé'
      using errcode = '23P01';
  end if;

  return query select terms.customer_type, terms.price_cents;
end;
$$;

revoke all on function public.assert_reservations_manage_resource(uuid)
from public, anon, authenticated;
revoke all on function public.admin_list_opening_hours(uuid) from public;
revoke all on function public.admin_save_opening_hour(bigint, uuid, smallint, time, time, boolean) from public;
revoke all on function public.admin_delete_opening_hour(bigint) from public;
revoke all on function public.admin_list_calendar_closures(uuid) from public;
revoke all on function public.admin_create_calendar_closure(uuid, text, timestamptz, timestamptz) from public;
revoke all on function public.admin_update_calendar_closure(uuid, text, timestamptz, timestamptz) from public;
revoke all on function public.admin_delete_calendar_closure(uuid) from public;
revoke all on function public.assert_reservation_slot_allowed(uuid, uuid, timestamptz, timestamptz, uuid) from public;

grant execute on function public.admin_list_opening_hours(uuid) to authenticated;
grant execute on function public.admin_save_opening_hour(bigint, uuid, smallint, time, time, boolean) to authenticated;
grant execute on function public.admin_delete_opening_hour(bigint) to authenticated;
grant execute on function public.admin_list_calendar_closures(uuid) to authenticated;
grant execute on function public.admin_create_calendar_closure(uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_update_calendar_closure(uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_delete_calendar_closure(uuid) to authenticated;
grant execute on function public.assert_reservation_slot_allowed(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated;
