begin;

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
    cross join public.reservation_settings as settings
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
    cross join lateral public.get_reservation_terms(auth.uid(), slot.starts_at) as terms
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
$function$
;

CREATE OR REPLACE FUNCTION public.list_calendar_occupations(target_resource_id uuid, range_start timestamp with time zone, range_end timestamp with time zone)
 RETURNS TABLE(id uuid, resource_id uuid, occupation_type occupation_type, title text, starts_at timestamp with time zone, ends_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    occupation.id,
    occupation.resource_id,
    occupation.occupation_type,
    case
      when occupation.occupation_type = 'reservation'::public.occupation_type then
        coalesce(
          nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
          nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
          nullif(btrim(profile.display_name), ''),
          nullif(btrim(reservation.guest_name), ''),
          'Réservation'
        )
      else coalesce(nullif(btrim(occupation.title), ''), 'Indisponibilité exceptionnelle')
    end as title,
    occupation.starts_at,
    occupation.ends_at
  from public.calendar_occupations as occupation
  join public.reservable_resources as resource
    on resource.id = occupation.resource_id
  left join public.reservations as reservation
    on reservation.id = occupation.reservation_id
  left join public.profiles as profile
    on profile.id = reservation.user_id
  left join public.club_members as member
    on member.id = public.profile_club_member_id(profile.id, resource.club_id)
  where occupation.resource_id = target_resource_id
    and resource.is_active
    and occupation.cancelled_at is null
    and occupation.starts_at < range_end
    and occupation.ends_at > range_start
  order by occupation.starts_at;
$function$
;

CREATE OR REPLACE FUNCTION public.publish_permanent_slot_reminder(target_occurrence_id uuid, target_reminder_kind text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target record;
  target_communication_id uuid;
  target_recipient_count integer := 0;
  target_management_opens_at timestamptz;
  target_day_before_at timestamptz;
  target_title text;
  target_body text;
begin
  if target_reminder_kind not in ('management_open', 'day_before_24h') then
    return 0;
  end if;

  select
    occurrence.id as occurrence_id,
    occurrence.status,
    slot.id as permanent_slot_id,
    slot.club_id,
    slot.label,
    slot.management_window_hours,
    occupation.starts_at,
    occupation.ends_at,
    resource.name as resource_name,
    resource.timezone as resource_timezone
  into target
  from public.permanent_slot_occurrences as occurrence
  join public.permanent_slots as slot
    on slot.id = occurrence.permanent_slot_id
   and slot.is_active
  join public.calendar_occupations as occupation
    on occupation.id = occurrence.occupation_id
   and occupation.cancelled_at is null
  join public.reservable_resources as resource
    on resource.id = slot.resource_id
  where occurrence.id = target_occurrence_id
    and occurrence.status = 'scheduled'::public.permanent_slot_occurrence_status;

  if not found or target.starts_at <= now() then
    return 0;
  end if;

  target_management_opens_at := target.starts_at
    - make_interval(hours => target.management_window_hours);
  target_day_before_at := target.starts_at - interval '24 hours';

  if target_reminder_kind = 'management_open' then
    if now() < target_management_opens_at then
      return 0;
    end if;

    if target.management_window_hours > 24 and now() >= target_day_before_at then
      return 0;
    end if;

    target_title := 'Créneau permanent · action attendue';
    target_body := format(
      'Votre créneau « %s » sur %s est prévu le %s de %s à %s. Vous pouvez le maintenir ou le libérer depuis Mes créneaux permanents.',
      target.label,
      target.resource_name,
      to_char(target.starts_at at time zone target.resource_timezone, 'DD/MM/YYYY'),
      to_char(target.starts_at at time zone target.resource_timezone, 'HH24:MI'),
      to_char(target.ends_at at time zone target.resource_timezone, 'HH24:MI')
    );
  else
    if target.management_window_hours <= 24
      or now() < target_day_before_at
    then
      return 0;
    end if;

    target_title := 'Rappel · créneau permanent dans moins de 24 h';
    target_body := format(
      'Votre créneau « %s » sur %s est prévu le %s de %s à %s. Si vous ne l’utilisez pas, pensez à le libérer.',
      target.label,
      target.resource_name,
      to_char(target.starts_at at time zone target.resource_timezone, 'DD/MM/YYYY'),
      to_char(target.starts_at at time zone target.resource_timezone, 'HH24:MI'),
      to_char(target.ends_at at time zone target.resource_timezone, 'HH24:MI')
    );
  end if;

  if exists (
    select 1
    from public.permanent_slot_reminder_events as event
    where event.occurrence_id = target.occurrence_id
      and event.reminder_kind = target_reminder_kind
  ) then
    return 0;
  end if;

  insert into public.club_communications (
    club_id,
    title,
    body,
    priority,
    status,
    show_on_home,
    expires_at,
    created_by,
    updated_by
  )
  values (
    target.club_id,
    target_title,
    target_body,
    'important',
    'draft',
    false,
    target.starts_at,
    null,
    null
  )
  returning id into target_communication_id;

  insert into public.permanent_slot_reminder_events (
    occurrence_id,
    reminder_kind,
    communication_id
  )
  values (
    target.occurrence_id,
    target_reminder_kind,
    target_communication_id
  )
  on conflict (occurrence_id, reminder_kind) do nothing;

  if not found then
    delete from public.club_communications
    where id = target_communication_id;
    return 0;
  end if;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  )
  values (
    target.club_id,
    target_communication_id,
    'created',
    null,
    jsonb_build_object(
      'source', 'permanent_slot_reminder_cron',
      'permanent_slot_id', target.permanent_slot_id,
      'occurrence_id', target.occurrence_id,
      'reminder_kind', target_reminder_kind
    )
  );

  with recipient_candidates as (
    select distinct
      profile.id as profile_id,
      member.id as club_member_id,
      coalesce(
        nullif(btrim(member.email), ''),
        nullif(btrim(profile.email), '')
      ) as email_snapshot
    from public.permanent_slot_managers as manager
    join public.profiles as profile
      on profile.id = manager.profile_id
    left join public.club_members as member
      on member.id = public.profile_club_member_id(profile.id, target.club_id)
    where manager.permanent_slot_id = target.permanent_slot_id
  )
  insert into public.communication_deliveries (
    communication_id,
    club_id,
    club_member_id,
    profile_id_at_publication,
    email_snapshot,
    email_status
  )
  select
    target_communication_id,
    target.club_id,
    candidate.club_member_id,
    candidate.profile_id,
    candidate.email_snapshot,
    case
      when candidate.email_snapshot is null
        then 'unavailable'::public.communication_email_status
      else 'not_configured'::public.communication_email_status
    end
  from recipient_candidates as candidate
  on conflict do nothing;

  get diagnostics target_recipient_count = row_count;

  if target_recipient_count = 0 then
    delete from public.permanent_slot_reminder_events
    where occurrence_id = target.occurrence_id
      and reminder_kind = target_reminder_kind;

    delete from public.club_communications
    where id = target_communication_id;

    return 0;
  end if;

  update public.club_communications
  set status = 'published',
      published_at = now(),
      updated_at = now()
  where id = target_communication_id;

  insert into public.communication_audit_log (
    club_id,
    communication_id,
    action,
    actor_id,
    new_data
  )
  values (
    target.club_id,
    target_communication_id,
    'published',
    null,
    jsonb_build_object(
      'source', 'permanent_slot_reminder_cron',
      'permanent_slot_id', target.permanent_slot_id,
      'occurrence_id', target.occurrence_id,
      'reminder_kind', target_reminder_kind,
      'recipient_count', target_recipient_count
    )
  );

  return target_recipient_count;
end;
$function$
;

commit;
