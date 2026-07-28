create function public.admin_get_reservation_settings()
returns table (
  licensee_advance_hours integer,
  public_advance_hours integer,
  licensee_price_cents integer,
  public_price_cents integer,
  default_duration_minutes integer,
  booking_step_minutes integer,
  minimum_notice_minutes integer,
  licensee_max_active_reservations integer,
  public_max_active_reservations integer
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
    settings.licensee_max_active_reservations,
    settings.public_max_active_reservations
  from public.reservation_settings as settings
  where settings.id;
end;
$$;

create function public.admin_update_reservation_settings(
  new_licensee_advance_hours integer,
  new_public_advance_hours integer,
  new_licensee_price_cents integer,
  new_public_price_cents integer,
  new_default_duration_minutes integer,
  new_booking_step_minutes integer,
  new_minimum_notice_minutes integer,
  new_licensee_max_active_reservations integer,
  new_public_max_active_reservations integer
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
    or new_licensee_max_active_reservations <= 0
    or new_public_max_active_reservations <= 0 then
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
      licensee_max_active_reservations = new_licensee_max_active_reservations,
      public_max_active_reservations = new_public_max_active_reservations,
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

create function public.admin_list_opening_hours(target_resource_id uuid)
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
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  return query
  select hours.id, hours.resource_id, hours.weekday, hours.opens_at,
    hours.closes_at, hours.is_open
  from public.resource_opening_hours as hours
  where hours.resource_id = target_resource_id
  order by hours.weekday, hours.opens_at;
end;
$$;

create function public.admin_save_opening_hour(
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
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if target_weekday not between 0 and 6 or target_closes_at <= target_opens_at then
    raise exception 'Horaire invalide' using errcode = '22023';
  end if;

  if target_id is null then
    insert into public.resource_opening_hours (
      resource_id, weekday, opens_at, closes_at, is_open
    ) values (
      target_resource_id, target_weekday, target_opens_at,
      target_closes_at, target_is_active
    ) returning id into saved_id;
  else
    update public.resource_opening_hours
    set resource_id = target_resource_id,
        weekday = target_weekday,
        opens_at = target_opens_at,
        closes_at = target_closes_at,
        is_open = target_is_active,
        updated_at = now()
    where id = target_id
    returning id into saved_id;
  end if;

  return saved_id;
end;
$$;

create function public.admin_delete_opening_hour(target_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;
  delete from public.resource_opening_hours where id = target_id;
end;
$$;

create function public.admin_list_calendar_closures(target_resource_id uuid)
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
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  return query
  select occupation.id, occupation.resource_id, occupation.title,
    occupation.starts_at, occupation.ends_at
  from public.calendar_occupations as occupation
  where occupation.resource_id = target_resource_id
    and occupation.occupation_type = 'closure'
    and occupation.cancelled_at is null
  order by occupation.starts_at desc;
end;
$$;

create function public.admin_create_calendar_closure(
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
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if nullif(btrim(target_title), '') is null or target_ends_at <= target_starts_at then
    raise exception 'Fermeture invalide' using errcode = '22023';
  end if;

  insert into public.calendar_occupations (
    resource_id, occupation_type, title, starts_at, ends_at,
    created_by, updated_by
  ) values (
    target_resource_id, 'closure', btrim(target_title),
    target_starts_at, target_ends_at, auth.uid(), auth.uid()
  ) returning id into created_id;

  return created_id;
exception
  when exclusion_violation then
    raise exception 'Cette fermeture chevauche une occupation existante'
      using errcode = '23P01';
end;
$$;

create function public.admin_delete_calendar_closure(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  update public.calendar_occupations
  set cancelled_at = now(),
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_id
    and occupation_type = 'closure';
end;
$$;

revoke all on function public.admin_get_reservation_settings() from public;
revoke all on function public.admin_update_reservation_settings(integer, integer, integer, integer, integer, integer, integer, integer, integer) from public;
revoke all on function public.admin_list_opening_hours(uuid) from public;
revoke all on function public.admin_save_opening_hour(bigint, uuid, smallint, time, time, boolean) from public;
revoke all on function public.admin_delete_opening_hour(bigint) from public;
revoke all on function public.admin_list_calendar_closures(uuid) from public;
revoke all on function public.admin_create_calendar_closure(uuid, text, timestamptz, timestamptz) from public;
revoke all on function public.admin_delete_calendar_closure(uuid) from public;

grant execute on function public.admin_get_reservation_settings() to authenticated;
grant execute on function public.admin_update_reservation_settings(integer, integer, integer, integer, integer, integer, integer, integer, integer) to authenticated;
grant execute on function public.admin_list_opening_hours(uuid) to authenticated;
grant execute on function public.admin_save_opening_hour(bigint, uuid, smallint, time, time, boolean) to authenticated;
grant execute on function public.admin_delete_opening_hour(bigint) to authenticated;
grant execute on function public.admin_list_calendar_closures(uuid) to authenticated;
grant execute on function public.admin_create_calendar_closure(uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_delete_calendar_closure(uuid) to authenticated;
