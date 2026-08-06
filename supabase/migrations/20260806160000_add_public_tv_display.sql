create function public.get_public_tv_display(target_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings public.club_tv_settings;
  club_record public.clubs;
  display_day date := (now() at time zone 'Europe/Paris')::date;
begin
  select tv_settings.*
  into settings
  from public.club_tv_settings as tv_settings
  where tv_settings.public_token = target_token;

  if settings.club_id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select clubs.*
  into club_record
  from public.clubs as clubs
  where clubs.id = settings.club_id;

  if not settings.is_enabled then
    return jsonb_build_object(
      'status', 'disabled',
      'club_name', club_record.name,
      'club_logo_url', club_record.logo_url,
      'generated_at', now()
    );
  end if;

  return (
    with selected_resources as (
      select
        resources.id,
        resources.name,
        resources.timezone,
        selected.display_order
      from public.club_tv_resources as selected
      join public.reservable_resources as resources
        on resources.id = selected.resource_id
       and resources.club_id = selected.club_id
      where selected.club_id = settings.club_id
        and resources.is_active
    ),
    opening_periods as (
      select
        resources.id as resource_id,
        resources.name as resource_name,
        resources.timezone,
        resources.display_order,
        opening_hours.opens_at,
        opening_hours.closes_at,
        reservation_settings.default_duration_minutes,
        reservation_settings.booking_step_minutes
      from selected_resources as resources
      join public.resource_opening_hours as opening_hours
        on opening_hours.resource_id = resources.id
       and opening_hours.weekday = extract(dow from display_day)::smallint
       and opening_hours.is_open
      cross join public.reservation_settings as reservation_settings
    ),
    generated_slots as (
      select
        periods.resource_id,
        periods.resource_name,
        periods.display_order,
        slot_local at time zone periods.timezone as starts_at,
        (
          slot_local
          + make_interval(mins => periods.default_duration_minutes)
        ) at time zone periods.timezone as ends_at
      from opening_periods as periods
      cross join lateral generate_series(
        greatest(
          display_day + periods.opens_at,
          display_day + settings.display_start_time
        ),
        least(
          display_day + periods.closes_at,
          display_day + settings.display_end_time
        ) - make_interval(mins => periods.default_duration_minutes),
        make_interval(mins => periods.booking_step_minutes)
      ) as slot_local
    ),
    projected_slots as (
      select
        slots.resource_id,
        slots.starts_at,
        slots.ends_at,
        case
          when occupation.id is null then 'available'
          when occupation.occupation_type = 'reservation'::public.occupation_type then 'reserved'
          else 'unavailable'
        end as status,
        case
          when occupation.id is null then null
          when occupation.occupation_type = 'reservation'::public.occupation_type then
            coalesce(
              nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
              nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
              nullif(btrim(profile.display_name), ''),
              nullif(btrim(reservation.guest_name), ''),
              'Réservation'
            )
          else coalesce(nullif(btrim(occupation.title), ''), 'Indisponible')
        end as display_name
      from generated_slots as slots
      left join lateral (
        select current_occupation.*
        from public.calendar_occupations as current_occupation
        where current_occupation.resource_id = slots.resource_id
          and current_occupation.cancelled_at is null
          and current_occupation.starts_at < slots.ends_at
          and current_occupation.ends_at > slots.starts_at
        order by current_occupation.starts_at
        limit 1
      ) as occupation on true
      left join public.reservations as reservation
        on reservation.id = occupation.reservation_id
      left join public.profiles as profile
        on profile.id = reservation.user_id
      left join public.club_members as member
        on member.id = profile.member_id
       and member.club_id = settings.club_id
      where slots.ends_at > now()
    ),
    ranked_slots as (
      select
        slots.*,
        row_number() over (
          partition by slots.resource_id
          order by slots.starts_at
        ) as slot_rank
      from projected_slots as slots
    ),
    resources_payload as (
      select
        resources.id,
        resources.name,
        resources.display_order,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'starts_at', slots.starts_at,
              'ends_at', slots.ends_at,
              'status', slots.status,
              'display_name', slots.display_name
            )
            order by slots.starts_at
          ) filter (
            where slots.slot_rank <= settings.visible_slot_count
          ),
          '[]'::jsonb
        ) as slots
      from selected_resources as resources
      left join ranked_slots as slots
        on slots.resource_id = resources.id
       and slots.slot_rank <= settings.visible_slot_count
      group by resources.id, resources.name, resources.display_order
    )
    select jsonb_build_object(
      'status', 'ready',
      'club_name', club_record.name,
      'club_logo_url', club_record.logo_url,
      'display_date', display_day,
      'display_start_time', to_char(settings.display_start_time, 'HH24:MI'),
      'display_end_time', to_char(settings.display_end_time, 'HH24:MI'),
      'refresh_interval_seconds', settings.refresh_interval_seconds,
      'generated_at', now(),
      'resources', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', resources.id,
            'name', resources.name,
            'slots', resources.slots
          )
          order by resources.display_order
        ),
        '[]'::jsonb
      )
    )
    from resources_payload as resources
  );
end;
$$;

revoke all on function public.get_public_tv_display(uuid) from public;
grant execute on function public.get_public_tv_display(uuid) to anon, authenticated;
