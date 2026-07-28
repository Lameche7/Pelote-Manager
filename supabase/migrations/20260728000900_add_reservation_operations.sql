create function public.list_admin_reservations(
  search_text text default null,
  status_filter public.reservation_status default null,
  range_start timestamptz default null,
  range_end timestamptz default null
)
returns table (
  id uuid,
  resource_name text,
  customer_name text,
  customer_email text,
  customer_type public.reservation_customer_type,
  status public.reservation_status,
  starts_at timestamptz,
  ends_at timestamptz,
  price_cents integer,
  created_at timestamptz
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
    reservation.id,
    resource.name,
    coalesce(profile.display_name, reservation.guest_name, 'Utilisateur'),
    coalesce(profile.email, reservation.guest_email, ''),
    reservation.customer_type,
    reservation.status,
    reservation.starts_at,
    reservation.ends_at,
    reservation.price_cents,
    reservation.created_at
  from public.reservations as reservation
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  left join public.profiles as profile on profile.id = reservation.user_id
  where (status_filter is null or reservation.status = status_filter)
    and (range_start is null or reservation.starts_at >= range_start)
    and (range_end is null or reservation.starts_at < range_end)
    and (
      nullif(btrim(search_text), '') is null
      or coalesce(profile.display_name, reservation.guest_name, '') ilike '%' || btrim(search_text) || '%'
      or coalesce(profile.email, reservation.guest_email, '') ilike '%' || btrim(search_text) || '%'
      or resource.name ilike '%' || btrim(search_text) || '%'
    )
  order by reservation.starts_at desc;
end;
$$;

revoke all on function public.list_admin_reservations(text, public.reservation_status, timestamptz, timestamptz) from public;
grant execute on function public.list_admin_reservations(text, public.reservation_status, timestamptz, timestamptz) to authenticated;

create function public.get_reservation_dashboard(
  range_start timestamptz,
  range_end timestamptz
)
returns table (
  total_reservations bigint,
  confirmed_reservations bigint,
  cancelled_reservations bigint,
  no_show_reservations bigint,
  licensee_reservations bigint,
  public_reservations bigint,
  theoretical_revenue_cents bigint
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
    count(*),
    count(*) filter (where status in ('confirmed', 'completed')),
    count(*) filter (where status = 'cancelled'),
    count(*) filter (where status = 'no_show'),
    count(*) filter (where customer_type = 'licensee'),
    count(*) filter (where customer_type <> 'licensee'),
    coalesce(sum(price_cents) filter (where status not in ('cancelled', 'refused', 'expired')), 0)
  from public.reservations
  where starts_at >= range_start
    and starts_at < range_end;
end;
$$;

revoke all on function public.get_reservation_dashboard(timestamptz, timestamptz) from public;
grant execute on function public.get_reservation_dashboard(timestamptz, timestamptz) to authenticated;

create function public.set_reservation_operational_status(
  target_reservation_id uuid,
  target_status public.reservation_status,
  reason text default null
)
returns public.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  previous_reservation public.reservations;
  updated_reservation public.reservations;
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if target_status not in ('confirmed', 'completed', 'cancelled', 'refused', 'expired', 'no_show') then
    raise exception 'Statut opérationnel non autorisé' using errcode = '22023';
  end if;

  select * into previous_reservation
  from public.reservations
  where id = target_reservation_id
  for update;

  if previous_reservation.id is null then
    raise exception 'Réservation introuvable' using errcode = 'P0002';
  end if;

  update public.reservations
  set status = target_status,
      cancelled_at = case when target_status = 'cancelled' then now() else cancelled_at end,
      cancelled_by = case when target_status = 'cancelled' then actor_id else cancelled_by end,
      cancellation_reason = case when target_status = 'cancelled' then nullif(btrim(reason), '') else cancellation_reason end,
      updated_at = now(),
      updated_by = actor_id
  where id = target_reservation_id
  returning * into updated_reservation;

  if target_status in ('cancelled', 'refused', 'expired') then
    update public.calendar_occupations
    set cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now(),
        updated_by = actor_id
    where reservation_id = target_reservation_id;
  end if;

  insert into public.reservation_audit_log (
    reservation_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    target_reservation_id,
    'status_changed:' || target_status::text,
    actor_id,
    to_jsonb(previous_reservation),
    to_jsonb(updated_reservation) || jsonb_build_object('reason', reason)
  );

  return updated_reservation;
end;
$$;

revoke all on function public.set_reservation_operational_status(uuid, public.reservation_status, text) from public;
grant execute on function public.set_reservation_operational_status(uuid, public.reservation_status, text) to authenticated;

create function public.expire_past_pending_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if auth.uid() is not null and not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  with expired as (
    update public.reservations
    set status = 'expired',
        updated_at = now(),
        updated_by = auth.uid()
    where status = 'pending'
      and starts_at <= now()
    returning id
  )
  select count(*) into affected from expired;

  update public.calendar_occupations
  set cancelled_at = coalesce(cancelled_at, now()),
      updated_at = now(),
      updated_by = auth.uid()
  where reservation_id in (
    select id from public.reservations where status = 'expired'
  ) and cancelled_at is null;

  return affected;
end;
$$;

revoke all on function public.expire_past_pending_reservations() from public;
grant execute on function public.expire_past_pending_reservations() to authenticated;
