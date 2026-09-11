begin;

create table public.championship_reservation_settings (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  enabled boolean not null default false,
  advance_days integer not null default 90 check (advance_days between 1 and 365),
  max_active_reservations integer not null default 20
    check (max_active_reservations between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null
);

create table public.championship_reservation_resources (
  club_id uuid not null references public.clubs(id) on delete cascade,
  resource_id uuid not null references public.reservable_resources(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (club_id, resource_id)
);

create table public.championship_reservation_windows (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at),
  unique (club_id, weekday)
);

alter table public.championship_reservation_settings enable row level security;
alter table public.championship_reservation_resources enable row level security;
alter table public.championship_reservation_windows enable row level security;

revoke all on table public.championship_reservation_settings from public, anon, authenticated;
revoke all on table public.championship_reservation_resources from public, anon, authenticated;
revoke all on table public.championship_reservation_windows from public, anon, authenticated;

create or replace function public.championship_reservation_player_is_eligible(
  target_club_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null and exists (
    select 1
    from public.championship_players as player
    join public.championship_team_players as team_player
      on team_player.player_id = player.id
    join public.championship_teams as team
      on team.id = team_player.team_id
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    join public.championship_divisions as division
      on division.id = team.division_id
    join public.championships as championship
      on championship.id = division.championship_id
    join public.championship_club_links as club_link
      on club_link.championship_id = championship.id
     and club_link.federation_club_id = federation_club.id
     and club_link.club_id = target_club_id
    where player.profile_id = target_user_id
      and player.link_status in ('claimed', 'verified')
      and federation_club.linked_club_id = target_club_id
      and championship.status in ('preparation', 'active')
  );
$$;

revoke all on function public.championship_reservation_player_is_eligible(uuid, uuid)
from public, anon, authenticated;

create or replace function public.get_championship_reservation_access(
  target_resource_id uuid,
  target_user_id uuid,
  target_starts_at timestamptz,
  target_ends_at timestamptz
)
returns table (
  is_priority boolean,
  advance_hours integer,
  max_active_reservations integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
  from public.reservation_settings as settings
  where settings.id;

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
$$;

revoke all on function public.get_championship_reservation_access(
  uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated;

create or replace function public.admin_get_championship_reservation_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  setting public.championship_reservation_settings%rowtype;
begin
  if not public.has_club_permission(target_club_id, 'championships.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select *
  into setting
  from public.championship_reservation_settings
  where club_id = target_club_id;

  return jsonb_build_object(
    'clubId', target_club_id,
    'enabled', coalesce(setting.enabled, false),
    'advanceDays', coalesce(setting.advance_days, 90),
    'maxActiveReservations', coalesce(setting.max_active_reservations, 20),
    'eligiblePlayerCount', (
      select count(distinct player.profile_id)
      from public.championship_players as player
      join public.championship_team_players as team_player
        on team_player.player_id = player.id
      join public.championship_teams as team
        on team.id = team_player.team_id
      join public.championship_federation_clubs as federation_club
        on federation_club.id = team.federation_club_id
      join public.championship_divisions as division
        on division.id = team.division_id
      join public.championships as championship
        on championship.id = division.championship_id
      join public.championship_club_links as club_link
        on club_link.championship_id = championship.id
       and club_link.federation_club_id = federation_club.id
       and club_link.club_id = target_club_id
      where player.profile_id is not null
        and player.link_status in ('claimed', 'verified')
        and federation_club.linked_club_id = target_club_id
        and championship.status in ('preparation', 'active')
    ),
    'resources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', resource.id,
          'name', resource.name,
          'selected', selected_resource.resource_id is not null
        )
        order by resource.name
      )
      from public.reservable_resources as resource
      left join public.championship_reservation_resources as selected_resource
        on selected_resource.club_id = target_club_id
       and selected_resource.resource_id = resource.id
      where resource.club_id = target_club_id
        and resource.is_active
    ), '[]'::jsonb),
    'windows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', priority_window.weekday,
          'opensAt', to_char(priority_window.opens_at, 'HH24:MI'),
          'closesAt', to_char(priority_window.closes_at, 'HH24:MI')
        )
        order by priority_window.weekday
      )
      from public.championship_reservation_windows as priority_window
      where priority_window.club_id = target_club_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_get_championship_reservation_settings()
from public, anon, authenticated;
grant execute on function public.admin_get_championship_reservation_settings()
to authenticated;

create or replace function public.admin_save_championship_reservation_settings(
  target_enabled boolean,
  target_advance_days integer,
  target_max_active_reservations integer,
  target_resource_ids uuid[],
  target_windows jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  resource_count integer;
  requested_resource_count integer;
  window_value jsonb;
  weekday_value integer;
  opens_value time;
  closes_value time;
begin
  if not public.has_club_permission(target_club_id, 'championships.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if target_advance_days not between 1 and 365
    or target_max_active_reservations not between 1 and 100 then
    raise exception 'Paramètres de réservation championnat invalides'
      using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(target_windows, '[]'::jsonb)) <> 'array' then
    raise exception 'Les plages horaires sont invalides'
      using errcode = '22023';
  end if;

  select count(distinct resource_id)
  into requested_resource_count
  from unnest(coalesce(target_resource_ids, '{}'::uuid[])) as resource_id;

  select count(*)
  into resource_count
  from public.reservable_resources as resource
  where resource.id = any(coalesce(target_resource_ids, '{}'::uuid[]))
    and resource.club_id = target_club_id
    and resource.is_active;

  if resource_count <> requested_resource_count then
    raise exception 'Un terrain sélectionné est invalide'
      using errcode = '22023';
  end if;

  if target_enabled
    and (
      requested_resource_count = 0
      or jsonb_array_length(coalesce(target_windows, '[]'::jsonb)) = 0
    ) then
    raise exception 'Sélectionnez au moins un terrain et une plage horaire'
      using errcode = '22023';
  end if;

  insert into public.championship_reservation_settings (
    club_id,
    enabled,
    advance_days,
    max_active_reservations,
    created_by,
    updated_by
  ) values (
    target_club_id,
    target_enabled,
    target_advance_days,
    target_max_active_reservations,
    auth.uid(),
    auth.uid()
  )
  on conflict (club_id) do update set
    enabled = excluded.enabled,
    advance_days = excluded.advance_days,
    max_active_reservations = excluded.max_active_reservations,
    updated_at = now(),
    updated_by = auth.uid();

  delete from public.championship_reservation_resources
  where club_id = target_club_id;

  insert into public.championship_reservation_resources (club_id, resource_id)
  select target_club_id, resource_id
  from (
    select distinct resource_id
    from unnest(coalesce(target_resource_ids, '{}'::uuid[])) as resource_id
  ) as selected;

  delete from public.championship_reservation_windows
  where club_id = target_club_id;

  for window_value in
    select value from jsonb_array_elements(coalesce(target_windows, '[]'::jsonb))
  loop
    weekday_value := nullif(window_value ->> 'weekday', '')::integer;
    opens_value := nullif(window_value ->> 'opensAt', '')::time;
    closes_value := nullif(window_value ->> 'closesAt', '')::time;

    if weekday_value not between 1 and 7
      or opens_value is null
      or closes_value is null
      or closes_value <= opens_value then
      raise exception 'Une plage horaire championnat est invalide'
        using errcode = '22023';
    end if;

    insert into public.championship_reservation_windows (
      club_id,
      weekday,
      opens_at,
      closes_at
    ) values (
      target_club_id,
      weekday_value,
      opens_value,
      closes_value
    );
  end loop;
end;
$$;

revoke all on function public.admin_save_championship_reservation_settings(
  boolean, integer, integer, uuid[], jsonb
) from public, anon, authenticated;
grant execute on function public.admin_save_championship_reservation_settings(
  boolean, integer, integer, uuid[], jsonb
) to authenticated;

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
  championship_access record;
  active_count integer;
  booking_opens_at timestamptz;
  local_start timestamp;
  local_end timestamp;
  regular_opening_allowed boolean;
  effective_advance_hours integer;
  effective_max_active integer;
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

  select *
  into strict championship_access
  from public.get_championship_reservation_access(
    target_resource_id,
    target_user_id,
    target_starts_at,
    target_ends_at
  );

  if local_start::date <> local_end::date
    or (not regular_opening_allowed and not championship_access.is_priority) then
    raise exception 'Ce créneau se situe hors des horaires de réservation'
      using errcode = 'P0001';
  end if;

  select *
  into strict terms
  from public.get_reservation_terms(target_user_id, target_starts_at);

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

revoke all on function public.assert_reservation_slot_allowed(
  uuid, uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.assert_reservation_slot_allowed(
  uuid, uuid, timestamptz, timestamptz, uuid
) to authenticated;

create or replace function public.list_available_slots(
  target_resource_id uuid,
  range_start date,
  range_end date
)
returns table (
  resource_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  booking_opens_at timestamptz,
  booked_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
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
            nullif(
              btrim(concat_ws(' ', club_member.first_name, club_member.last_name)),
              ''
            ),
            nullif(
              btrim(concat_ws(' ', profile.first_name, profile.last_name)),
              ''
            ),
            nullif(btrim(profile.display_name), ''),
            nullif(btrim(reservation.guest_name), ''),
            'Réservation'
          )
        when occupation.id is not null then
          coalesce(
            nullif(btrim(occupation.title), ''),
            'Indisponibilité exceptionnelle'
          )
        else null
      end as booked_by_name
    from slots_with_terms as slot
    left join public.calendar_occupations as occupation
      on occupation.resource_id = slot.resource_id
     and occupation.cancelled_at is null
     and occupation.starts_at = slot.starts_at
     and occupation.ends_at = slot.ends_at
    left join public.reservations as reservation
      on reservation.id = occupation.reservation_id
    left join public.profiles as profile
      on profile.id = reservation.user_id
    left join public.club_members as club_member
      on club_member.id = profile.member_id
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
            nullif(
              btrim(concat_ws(' ', club_member.first_name, club_member.last_name)),
              ''
            ),
            nullif(
              btrim(concat_ws(' ', profile.first_name, profile.last_name)),
              ''
            ),
            nullif(btrim(profile.display_name), ''),
            nullif(btrim(reservation.guest_name), ''),
            'Réservation'
          )
        else coalesce(
          nullif(btrim(occupation.title), ''),
          'Indisponibilité exceptionnelle'
        )
      end as booked_by_name
    from public.calendar_occupations as occupation
    join public.reservable_resources as resource
      on resource.id = occupation.resource_id
     and resource.is_active
    left join public.reservations as reservation
      on reservation.id = occupation.reservation_id
    left join public.profiles as profile
      on profile.id = reservation.user_id
    left join public.club_members as club_member
      on club_member.id = profile.member_id
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
$$;

revoke all on function public.list_available_slots(uuid, date, date) from public;
grant execute on function public.list_available_slots(uuid, date, date)
to anon, authenticated;

drop function if exists public.list_available_slots_v2(uuid, date, date);

create function public.list_available_slots_v2(
  target_resource_id uuid,
  range_start date,
  range_end date
)
returns table (
  resource_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  booking_opens_at timestamptz,
  booked_by_name text,
  occupation_type text,
  display_color text,
  reservation_access text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    slot.resource_id,
    slot.starts_at,
    slot.ends_at,
    slot.status,
    slot.booking_opens_at,
    slot.booked_by_name,
    metadata.occupation_type,
    metadata.display_color,
    case when access.is_priority then 'championship' else 'standard' end
  from public.list_available_slots(
    target_resource_id,
    range_start,
    range_end
  ) as slot
  cross join lateral public.get_championship_reservation_access(
    slot.resource_id,
    auth.uid(),
    slot.starts_at,
    slot.ends_at
  ) as access
  left join lateral (
    select
      occupation.occupation_type::text as occupation_type,
      series.color as display_color
    from public.calendar_occupations as occupation
    left join public.event_resources as event_resource
      on event_resource.calendar_occupation_id = occupation.id
    left join public.tournament_match_events as match_event
      on match_event.event_id = event_resource.event_id
    left join public.tournament_matches as match
      on match.id = match_event.match_id
    left join public.tournament_series as series
      on series.id = match.series_id
    where occupation.resource_id = slot.resource_id
      and occupation.cancelled_at is null
      and occupation.starts_at = slot.starts_at
      and occupation.ends_at = slot.ends_at
    order by
      case when series.color is not null then 0 else 1 end,
      occupation.id
    limit 1
  ) as metadata on true
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots_v2(uuid, date, date)
from public;
grant execute on function public.list_available_slots_v2(uuid, date, date)
to anon, authenticated;

commit;
