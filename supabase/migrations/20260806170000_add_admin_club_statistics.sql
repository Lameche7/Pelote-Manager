create function public.admin_get_club_statistics(
  target_start_date date,
  target_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  target_club_name text;
  active_season jsonb;
begin
  if target_start_date is null or target_end_date is null then
    raise exception 'Période statistique incomplète' using errcode = '22023';
  end if;

  if target_end_date < target_start_date then
    raise exception 'La date de fin doit être postérieure à la date de début'
      using errcode = '22023';
  end if;

  if target_end_date - target_start_date > 366 then
    raise exception 'La période statistique ne peut pas dépasser 367 jours'
      using errcode = '22023';
  end if;

  target_club_id := public.admin_current_club_id();

  if not public.has_club_permission(target_club_id, 'statistics.read') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select clubs.name
  into target_club_name
  from public.clubs as clubs
  where clubs.id = target_club_id;

  select jsonb_build_object(
    'id', seasons.id,
    'name', seasons.name,
    'starts_on', seasons.starts_on,
    'ends_on', seasons.ends_on
  )
  into active_season
  from public.club_seasons as seasons
  where seasons.club_id = target_club_id
    and seasons.is_active
  limit 1;

  return (
    with reservation_configuration as (
      select
        settings.default_duration_minutes,
        settings.booking_step_minutes
      from public.reservation_settings as settings
      where settings.id
    ),
    club_resources as (
      select
        resources.id,
        resources.name,
        resources.timezone,
        resources.is_active
      from public.reservable_resources as resources
      where resources.club_id = target_club_id
    ),
    calendar_days as (
      select generated_day::date as day
      from generate_series(
        target_start_date,
        target_end_date,
        interval '1 day'
      ) as generated_day
    ),
    capacity_slots as (
      select
        resources.id as resource_id,
        count(*)::integer as slot_count
      from club_resources as resources
      join public.resource_opening_hours as opening_hours
        on opening_hours.resource_id = resources.id
       and opening_hours.is_open
      cross join reservation_configuration as configuration
      cross join calendar_days as calendar_day
      cross join lateral generate_series(
        calendar_day.day + opening_hours.opens_at,
        calendar_day.day + opening_hours.closes_at
          - make_interval(mins => configuration.default_duration_minutes),
        make_interval(mins => configuration.booking_step_minutes)
      ) as generated_slot
      where resources.is_active
        and opening_hours.weekday = extract(dow from calendar_day.day)::smallint
      group by resources.id
    ),
    period_reservations as (
      select
        reservations.id,
        reservations.resource_id,
        reservations.customer_type,
        reservations.status,
        reservations.price_cents,
        reservations.payment_status,
        reservations.starts_at,
        resources.timezone,
        (reservations.starts_at at time zone resources.timezone)::date as local_day,
        extract(hour from reservations.starts_at at time zone resources.timezone)::integer as local_hour,
        extract(dow from reservations.starts_at at time zone resources.timezone)::integer as local_weekday
      from public.reservations as reservations
      join club_resources as resources
        on resources.id = reservations.resource_id
      where (reservations.starts_at at time zone resources.timezone)::date
        between target_start_date and target_end_date
        and reservations.status <> 'draft'::public.reservation_status
    ),
    valid_reservations as (
      select *
      from period_reservations
      where status in (
        'confirmed'::public.reservation_status,
        'completed'::public.reservation_status,
        'no_show'::public.reservation_status
      )
    ),
    period_payments as (
      select
        payments.id,
        payments.reservation_id,
        reservations.resource_id,
        payments.status,
        payments.amount_cents
      from public.payments as payments
      join public.reservations as reservations
        on reservations.id = payments.reservation_id
      join club_resources as resources
        on resources.id = reservations.resource_id
      where (reservations.starts_at at time zone resources.timezone)::date
        between target_start_date and target_end_date
    ),
    paid_by_resource as (
      select
        payments.resource_id,
        coalesce(sum(payments.amount_cents) filter (
          where payments.status = 'paid'::public.payment_status
        ), 0)::integer as paid_cents
      from period_payments as payments
      group by payments.resource_id
    ),
    resource_rows as (
      select
        resources.id,
        resources.name,
        count(reservations.id) filter (
          where reservations.status in (
            'confirmed'::public.reservation_status,
            'completed'::public.reservation_status,
            'no_show'::public.reservation_status
          )
        )::integer as reservations,
        count(reservations.id) filter (
          where reservations.status = 'cancelled'::public.reservation_status
        )::integer as cancellations,
        coalesce(capacity.slot_count, 0)::integer as capacity_slots,
        count(reservations.id) filter (
          where reservations.status in (
            'confirmed'::public.reservation_status,
            'completed'::public.reservation_status,
            'no_show'::public.reservation_status
          )
        )::integer as occupied_slots,
        case
          when coalesce(capacity.slot_count, 0) = 0 then 0
          else round(
            100.0 * count(reservations.id) filter (
              where reservations.status in (
                'confirmed'::public.reservation_status,
                'completed'::public.reservation_status,
                'no_show'::public.reservation_status
              )
            ) / capacity.slot_count,
            1
          )
        end as occupancy_rate,
        coalesce(sum(reservations.price_cents) filter (
          where reservations.status in (
            'confirmed'::public.reservation_status,
            'completed'::public.reservation_status,
            'no_show'::public.reservation_status
          )
        ), 0)::integer as expected_revenue_cents,
        coalesce(paid.paid_cents, 0)::integer as paid_revenue_cents
      from club_resources as resources
      left join period_reservations as reservations
        on reservations.resource_id = resources.id
      left join capacity_slots as capacity
        on capacity.resource_id = resources.id
      left join paid_by_resource as paid
        on paid.resource_id = resources.id
      group by
        resources.id,
        resources.name,
        capacity.slot_count,
        paid.paid_cents
    ),
    day_rows as (
      select
        days.day,
        count(reservations.id) filter (
          where reservations.status in (
            'confirmed'::public.reservation_status,
            'completed'::public.reservation_status,
            'no_show'::public.reservation_status
          )
        )::integer as reservations,
        count(reservations.id) filter (
          where reservations.status = 'cancelled'::public.reservation_status
        )::integer as cancellations,
        coalesce(sum(reservations.price_cents) filter (
          where reservations.status in (
            'confirmed'::public.reservation_status,
            'completed'::public.reservation_status,
            'no_show'::public.reservation_status
          )
        ), 0)::integer as expected_revenue_cents
      from calendar_days as days
      left join period_reservations as reservations
        on reservations.local_day = days.day
      group by days.day
      order by days.day
    ),
    weekday_rows as (
      select
        weekdays.weekday,
        (array[
          'Dimanche',
          'Lundi',
          'Mardi',
          'Mercredi',
          'Jeudi',
          'Vendredi',
          'Samedi'
        ]::text[])[weekdays.weekday + 1] as label,
        count(valid.id)::integer as reservations
      from generate_series(0, 6) as weekdays(weekday)
      left join valid_reservations as valid
        on valid.local_weekday = weekdays.weekday
      group by weekdays.weekday
      order by weekdays.weekday
    ),
    hour_rows as (
      select
        hours.hour,
        lpad(hours.hour::text, 2, '0') || 'h' as label,
        count(valid.id)::integer as reservations
      from generate_series(0, 23) as hours(hour)
      left join valid_reservations as valid
        on valid.local_hour = hours.hour
      group by hours.hour
      order by hours.hour
    ),
    payment_rows as (
      select
        payment_statuses.status,
        count(payments.id)::integer as payment_count,
        coalesce(sum(payments.amount_cents), 0)::integer as amount_cents
      from unnest(enum_range(null::public.payment_status)) as payment_statuses(status)
      left join period_payments as payments
        on payments.status = payment_statuses.status
      group by payment_statuses.status
      order by payment_statuses.status::text
    )
    select jsonb_build_object(
      'status', 'ready',
      'club_name', target_club_name,
      'start_date', target_start_date,
      'end_date', target_end_date,
      'active_season', active_season,
      'summary', jsonb_build_object(
        'total_reservations', (
          select count(*)::integer from period_reservations
        ),
        'valid_reservations', (
          select count(*)::integer from valid_reservations
        ),
        'cancelled_reservations', (
          select count(*)::integer
          from period_reservations
          where status = 'cancelled'::public.reservation_status
        ),
        'no_show_reservations', (
          select count(*)::integer
          from period_reservations
          where status = 'no_show'::public.reservation_status
        ),
        'cancellation_rate', (
          select case
            when count(*) filter (
              where status in (
                'confirmed'::public.reservation_status,
                'completed'::public.reservation_status,
                'no_show'::public.reservation_status,
                'cancelled'::public.reservation_status
              )
            ) = 0 then 0
            else round(
              100.0 * count(*) filter (
                where status = 'cancelled'::public.reservation_status
              ) / count(*) filter (
                where status in (
                  'confirmed'::public.reservation_status,
                  'completed'::public.reservation_status,
                  'no_show'::public.reservation_status,
                  'cancelled'::public.reservation_status
                )
              ),
              1
            )
          end
          from period_reservations
        ),
        'capacity_slots', (
          select coalesce(sum(slot_count), 0)::integer from capacity_slots
        ),
        'occupied_slots', (
          select count(*)::integer from valid_reservations
        ),
        'occupancy_rate', (
          select case
            when coalesce(sum(slot_count), 0) = 0 then 0
            else round(
              100.0 * (select count(*) from valid_reservations)
              / sum(slot_count),
              1
            )
          end
          from capacity_slots
        ),
        'expected_revenue_cents', (
          select coalesce(sum(price_cents), 0)::integer
          from valid_reservations
        ),
        'paid_revenue_cents', (
          select coalesce(sum(amount_cents), 0)::integer
          from period_payments
          where status = 'paid'::public.payment_status
        ),
        'refunded_revenue_cents', (
          select coalesce(sum(amount_cents), 0)::integer
          from period_payments
          where status = 'refunded'::public.payment_status
        ),
        'licensee_reservations', (
          select count(*)::integer
          from valid_reservations
          where customer_type = 'licensee'::public.reservation_customer_type
        ),
        'account_reservations', (
          select count(*)::integer
          from valid_reservations
          where customer_type = 'account'::public.reservation_customer_type
        ),
        'guest_reservations', (
          select count(*)::integer
          from valid_reservations
          where customer_type = 'guest'::public.reservation_customer_type
        )
      ),
      'by_resource', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', rows.id,
            'name', rows.name,
            'reservations', rows.reservations,
            'cancellations', rows.cancellations,
            'capacity_slots', rows.capacity_slots,
            'occupied_slots', rows.occupied_slots,
            'occupancy_rate', rows.occupancy_rate,
            'expected_revenue_cents', rows.expected_revenue_cents,
            'paid_revenue_cents', rows.paid_revenue_cents
          )
          order by rows.name
        )
        from resource_rows as rows
      ), '[]'::jsonb),
      'by_day', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'day', rows.day,
            'reservations', rows.reservations,
            'cancellations', rows.cancellations,
            'expected_revenue_cents', rows.expected_revenue_cents
          )
          order by rows.day
        )
        from day_rows as rows
      ), '[]'::jsonb),
      'by_weekday', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'weekday', rows.weekday,
            'label', rows.label,
            'reservations', rows.reservations
          )
          order by rows.weekday
        )
        from weekday_rows as rows
      ), '[]'::jsonb),
      'by_hour', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'hour', rows.hour,
            'label', rows.label,
            'reservations', rows.reservations
          )
          order by rows.hour
        )
        from hour_rows as rows
      ), '[]'::jsonb),
      'payment_statuses', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'status', rows.status,
            'count', rows.payment_count,
            'amount_cents', rows.amount_cents
          )
          order by rows.status::text
        )
        from payment_rows as rows
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.admin_get_club_statistics(date, date) from public;
grant execute on function public.admin_get_club_statistics(date, date) to authenticated;
