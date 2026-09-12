begin;

create type public.permanent_slot_occurrence_status as enum (
  'scheduled',
  'confirmed',
  'released',
  'cancelled'
);

create table public.permanent_slots (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  resource_id uuid not null references public.reservable_resources(id) on delete restrict,
  label text not null,
  weekday smallint not null check (weekday between 1 and 7),
  starts_at time not null,
  ends_at time not null,
  valid_from date not null,
  valid_until date not null,
  management_window_hours integer not null default 48
    check (management_window_hours between 1 and 168),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint permanent_slots_label_not_blank check (btrim(label) <> ''),
  constraint permanent_slots_valid_time check (ends_at > starts_at),
  constraint permanent_slots_valid_period check (valid_until >= valid_from),
  constraint permanent_slots_period_limited check (valid_until <= valid_from + 730)
);

create table public.permanent_slot_managers (
  permanent_slot_id uuid not null references public.permanent_slots(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (permanent_slot_id, profile_id)
);

create unique index permanent_slot_managers_one_primary_idx
on public.permanent_slot_managers(permanent_slot_id)
where is_primary;

create table public.permanent_slot_occurrences (
  id uuid primary key default gen_random_uuid(),
  permanent_slot_id uuid not null references public.permanent_slots(id) on delete cascade,
  occurrence_date date not null,
  status public.permanent_slot_occurrence_status not null default 'scheduled',
  occupation_id uuid not null unique references public.calendar_occupations(id) on delete restrict,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  released_at timestamptz,
  released_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (permanent_slot_id, occurrence_date),
  constraint permanent_slot_occurrences_release_metadata check (
    status <> 'released' or released_at is not null
  )
);

create table public.permanent_slot_audit_log (
  id bigint generated always as identity primary key,
  permanent_slot_id uuid not null references public.permanent_slots(id) on delete cascade,
  occurrence_id uuid references public.permanent_slot_occurrences(id) on delete set null,
  action text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  previous_status public.permanent_slot_occurrence_status,
  new_status public.permanent_slot_occurrence_status,
  created_at timestamptz not null default now(),
  constraint permanent_slot_audit_action_not_blank check (btrim(action) <> '')
);

create index permanent_slots_resource_active_idx
on public.permanent_slots(resource_id, is_active, valid_from, valid_until);

create index permanent_slot_occurrences_slot_date_idx
on public.permanent_slot_occurrences(permanent_slot_id, occurrence_date);

create index permanent_slot_managers_profile_idx
on public.permanent_slot_managers(profile_id, permanent_slot_id);

alter table public.permanent_slots enable row level security;
alter table public.permanent_slot_managers enable row level security;
alter table public.permanent_slot_occurrences enable row level security;
alter table public.permanent_slot_audit_log enable row level security;

revoke all on table public.permanent_slots from public, anon, authenticated;
revoke all on table public.permanent_slot_managers from public, anon, authenticated;
revoke all on table public.permanent_slot_occurrences from public, anon, authenticated;
revoke all on table public.permanent_slot_audit_log from public, anon, authenticated;

create or replace function public.admin_create_permanent_slot(
  target_resource_id uuid,
  target_label text,
  target_weekday smallint,
  target_starts_at time,
  target_ends_at time,
  target_valid_from date,
  target_valid_until date,
  target_management_window_hours integer,
  target_primary_profile_id uuid,
  target_manager_profile_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  resource_timezone text;
  default_duration integer;
  requested_duration integer;
  first_date date;
  occurrence_date date;
  occurrence_starts_at timestamptz;
  occurrence_ends_at timestamptz;
  created_slot_id uuid;
  created_occupation_id uuid;
  manager_profile_id uuid;
begin
  if not public.has_club_permission(target_club_id, 'reservations.manage') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  if target_weekday not between 1 and 7
    or target_starts_at is null
    or target_ends_at is null
    or target_ends_at <= target_starts_at
    or target_valid_from is null
    or target_valid_until is null
    or target_valid_until < target_valid_from
    or target_valid_until > target_valid_from + 730
    or target_management_window_hours not between 1 and 168
    or btrim(coalesce(target_label, '')) = '' then
    raise exception 'Paramètres du créneau permanent invalides'
      using errcode = '22023';
  end if;

  select resource.timezone
  into resource_timezone
  from public.reservable_resources as resource
  where resource.id = target_resource_id
    and resource.club_id = target_club_id
    and resource.is_active;

  if resource_timezone is null then
    raise exception 'Terrain invalide' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.profiles where id = target_primary_profile_id
  ) then
    raise exception 'Le titulaire principal doit posséder un compte PILOTOKI'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(coalesce(target_manager_profile_ids, '{}'::uuid[])) as manager_id
    left join public.profiles as profile on profile.id = manager_id
    where profile.id is null
  ) then
    raise exception 'Un gestionnaire sélectionné ne possède pas de compte PILOTOKI'
      using errcode = '22023';
  end if;

  select settings.default_duration_minutes
  into default_duration
  from public.reservation_settings as settings
  where settings.id;

  requested_duration := extract(epoch from (target_ends_at - target_starts_at))::integer / 60;

  if requested_duration <> default_duration then
    raise exception 'Le créneau permanent doit avoir la durée de réservation configurée (% min)',
      default_duration using errcode = '22023';
  end if;

  insert into public.permanent_slots (
    club_id,
    resource_id,
    label,
    weekday,
    starts_at,
    ends_at,
    valid_from,
    valid_until,
    management_window_hours,
    created_by,
    updated_by
  ) values (
    target_club_id,
    target_resource_id,
    btrim(target_label),
    target_weekday,
    target_starts_at,
    target_ends_at,
    target_valid_from,
    target_valid_until,
    target_management_window_hours,
    auth.uid(),
    auth.uid()
  ) returning id into created_slot_id;

  insert into public.permanent_slot_managers (
    permanent_slot_id,
    profile_id,
    is_primary
  ) values (
    created_slot_id,
    target_primary_profile_id,
    true
  );

  for manager_profile_id in
    select distinct manager_id
    from unnest(coalesce(target_manager_profile_ids, '{}'::uuid[])) as manager_id
    where manager_id <> target_primary_profile_id
  loop
    insert into public.permanent_slot_managers (
      permanent_slot_id,
      profile_id,
      is_primary
    ) values (
      created_slot_id,
      manager_profile_id,
      false
    );
  end loop;

  first_date := target_valid_from + (
    (target_weekday::integer - extract(isodow from target_valid_from)::integer + 7) % 7
  );
  occurrence_date := first_date;

  while occurrence_date <= target_valid_until loop
    occurrence_starts_at := (occurrence_date + target_starts_at) at time zone resource_timezone;
    occurrence_ends_at := (occurrence_date + target_ends_at) at time zone resource_timezone;

    if exists (
      select 1
      from public.calendar_occupations as occupation
      where occupation.resource_id = target_resource_id
        and occupation.cancelled_at is null
        and tstzrange(occupation.starts_at, occupation.ends_at, '[)')
          && tstzrange(occurrence_starts_at, occurrence_ends_at, '[)')
    ) then
      raise exception 'Impossible de créer le créneau permanent : conflit le %',
        to_char(occurrence_date, 'DD/MM/YYYY')
        using errcode = '23P01';
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
      'private_use'::public.occupation_type,
      'Créneau permanent · ' || btrim(target_label),
      occurrence_starts_at,
      occurrence_ends_at,
      auth.uid(),
      auth.uid()
    ) returning id into created_occupation_id;

    insert into public.permanent_slot_occurrences (
      permanent_slot_id,
      occurrence_date,
      occupation_id
    ) values (
      created_slot_id,
      occurrence_date,
      created_occupation_id
    );

    occurrence_date := occurrence_date + 7;
  end loop;

  insert into public.permanent_slot_audit_log (
    permanent_slot_id,
    action,
    actor_id
  ) values (
    created_slot_id,
    'slot_created',
    auth.uid()
  );

  return created_slot_id;
end;
$$;

revoke all on function public.admin_create_permanent_slot(
  uuid, text, smallint, time, time, date, date, integer, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.admin_create_permanent_slot(
  uuid, text, smallint, time, time, date, date, integer, uuid, uuid[]
) to authenticated;

create or replace function public.admin_list_permanent_slots()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.has_club_permission(public.admin_current_club_id(), 'reservations.manage')
      then public.raise_forbidden_jsonb()
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', slot.id,
          'label', slot.label,
          'resourceId', slot.resource_id,
          'resourceName', resource.name,
          'weekday', slot.weekday,
          'startsAt', to_char(slot.starts_at, 'HH24:MI'),
          'endsAt', to_char(slot.ends_at, 'HH24:MI'),
          'validFrom', slot.valid_from,
          'validUntil', slot.valid_until,
          'managementWindowHours', slot.management_window_hours,
          'isActive', slot.is_active,
          'managers', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'profileId', manager.profile_id,
                'displayName', coalesce(
                  nullif(btrim(profile.display_name), ''),
                  nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
                  profile.email
                ),
                'isPrimary', manager.is_primary
              )
              order by manager.is_primary desc, profile.display_name, profile.email
            )
            from public.permanent_slot_managers as manager
            join public.profiles as profile on profile.id = manager.profile_id
            where manager.permanent_slot_id = slot.id
          ), '[]'::jsonb)
        )
        order by slot.is_active desc, slot.weekday, slot.starts_at, slot.label
      )
      from public.permanent_slots as slot
      join public.reservable_resources as resource on resource.id = slot.resource_id
      where slot.club_id = public.admin_current_club_id()
    ), '[]'::jsonb)
  end;
$$;

revoke all on function public.admin_list_permanent_slots()
from public, anon, authenticated;
grant execute on function public.admin_list_permanent_slots()
to authenticated;

create or replace function public.admin_deactivate_permanent_slot(
  target_permanent_slot_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if not public.has_club_permission(target_club_id, 'reservations.manage') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.permanent_slots
    where id = target_permanent_slot_id
      and club_id = target_club_id
  ) then
    raise exception 'Créneau permanent introuvable' using errcode = 'P0002';
  end if;

  update public.permanent_slots
  set is_active = false,
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_permanent_slot_id;

  update public.calendar_occupations as occupation
  set cancelled_at = coalesce(occupation.cancelled_at, now()),
      updated_at = now(),
      updated_by = auth.uid()
  from public.permanent_slot_occurrences as occurrence
  where occurrence.permanent_slot_id = target_permanent_slot_id
    and occurrence.occupation_id = occupation.id
    and occupation.starts_at > now()
    and occurrence.status in ('scheduled', 'confirmed');

  update public.permanent_slot_occurrences
  set status = 'cancelled',
      updated_at = now()
  where permanent_slot_id = target_permanent_slot_id
    and occurrence_date >= current_date
    and status in ('scheduled', 'confirmed');

  insert into public.permanent_slot_audit_log (
    permanent_slot_id,
    action,
    actor_id
  ) values (
    target_permanent_slot_id,
    'slot_deactivated',
    auth.uid()
  );
end;
$$;

revoke all on function public.admin_deactivate_permanent_slot(uuid)
from public, anon, authenticated;
grant execute on function public.admin_deactivate_permanent_slot(uuid)
to authenticated;

create or replace function public.list_my_permanent_slot_occurrences(
  target_from date default current_date,
  target_to date default current_date + 21
)
returns table (
  occurrence_id uuid,
  permanent_slot_id uuid,
  label text,
  resource_id uuid,
  resource_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  management_opens_at timestamptz,
  can_manage_now boolean,
  is_rebooked boolean,
  is_primary boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    occurrence.id,
    slot.id,
    slot.label,
    resource.id,
    resource.name,
    occupation.starts_at,
    occupation.ends_at,
    occurrence.status::text,
    occupation.starts_at - make_interval(hours => slot.management_window_hours),
    now() >= occupation.starts_at - make_interval(hours => slot.management_window_hours)
      and now() < occupation.starts_at
      and occurrence.status <> 'cancelled'::public.permanent_slot_occurrence_status
      and not exists (
        select 1
        from public.calendar_occupations as other_occupation
        where other_occupation.resource_id = slot.resource_id
          and other_occupation.id <> occurrence.occupation_id
          and other_occupation.cancelled_at is null
          and tstzrange(other_occupation.starts_at, other_occupation.ends_at, '[)')
            && tstzrange(occupation.starts_at, occupation.ends_at, '[)')
      ),
    occurrence.status = 'released'::public.permanent_slot_occurrence_status
      and exists (
        select 1
        from public.calendar_occupations as other_occupation
        where other_occupation.resource_id = slot.resource_id
          and other_occupation.id <> occurrence.occupation_id
          and other_occupation.cancelled_at is null
          and tstzrange(other_occupation.starts_at, other_occupation.ends_at, '[)')
            && tstzrange(occupation.starts_at, occupation.ends_at, '[)')
      ),
    manager.is_primary
  from public.permanent_slot_managers as manager
  join public.permanent_slots as slot
    on slot.id = manager.permanent_slot_id
   and slot.is_active
  join public.permanent_slot_occurrences as occurrence
    on occurrence.permanent_slot_id = slot.id
  join public.calendar_occupations as occupation
    on occupation.id = occurrence.occupation_id
  join public.reservable_resources as resource
    on resource.id = slot.resource_id
  where manager.profile_id = auth.uid()
    and occurrence.occurrence_date between target_from and target_to
    and occurrence.status <> 'cancelled'::public.permanent_slot_occurrence_status
  order by occupation.starts_at;
$$;

revoke all on function public.list_my_permanent_slot_occurrences(date, date)
from public, anon, authenticated;
grant execute on function public.list_my_permanent_slot_occurrences(date, date)
to authenticated;

create or replace function public.set_my_permanent_slot_occurrence_status(
  target_occurrence_id uuid,
  target_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_slot_id uuid;
  target_occupation_id uuid;
  current_status public.permanent_slot_occurrence_status;
  target_starts_at timestamptz;
  target_ends_at timestamptz;
  target_resource_id uuid;
  management_window_hours integer;
  next_status public.permanent_slot_occurrence_status;
begin
  if target_status not in ('scheduled', 'confirmed', 'released') then
    raise exception 'Action invalide' using errcode = '22023';
  end if;

  next_status := target_status::public.permanent_slot_occurrence_status;

  select
    slot.id,
    occurrence.occupation_id,
    occurrence.status,
    occupation.starts_at,
    occupation.ends_at,
    slot.resource_id,
    slot.management_window_hours
  into
    target_slot_id,
    target_occupation_id,
    current_status,
    target_starts_at,
    target_ends_at,
    target_resource_id,
    management_window_hours
  from public.permanent_slot_occurrences as occurrence
  join public.permanent_slots as slot
    on slot.id = occurrence.permanent_slot_id
   and slot.is_active
  join public.permanent_slot_managers as manager
    on manager.permanent_slot_id = slot.id
   and manager.profile_id = auth.uid()
  join public.calendar_occupations as occupation
    on occupation.id = occurrence.occupation_id
  where occurrence.id = target_occurrence_id;

  if target_slot_id is null then
    raise exception 'Créneau permanent introuvable ou non autorisé'
      using errcode = '42501';
  end if;

  if current_status = 'cancelled'::public.permanent_slot_occurrence_status then
    raise exception 'Ce créneau permanent est annulé' using errcode = 'P0001';
  end if;

  if now() < target_starts_at - make_interval(hours => management_window_hours) then
    raise exception 'La gestion de ce créneau ouvrira % h avant son début',
      management_window_hours using errcode = 'P0001';
  end if;

  if now() >= target_starts_at then
    raise exception 'Ce créneau a déjà commencé' using errcode = 'P0001';
  end if;

  if next_status = 'released'::public.permanent_slot_occurrence_status then
    update public.calendar_occupations
    set cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now(),
        updated_by = auth.uid()
    where id = target_occupation_id;

    update public.permanent_slot_occurrences
    set status = 'released',
        released_at = now(),
        released_by = auth.uid(),
        updated_at = now()
    where id = target_occurrence_id;
  else
    if current_status = 'released'::public.permanent_slot_occurrence_status then
      if exists (
        select 1
        from public.calendar_occupations as other_occupation
        where other_occupation.resource_id = target_resource_id
          and other_occupation.id <> target_occupation_id
          and other_occupation.cancelled_at is null
          and tstzrange(other_occupation.starts_at, other_occupation.ends_at, '[)')
            && tstzrange(target_starts_at, target_ends_at, '[)')
      ) then
        raise exception 'Ce créneau a déjà été repris par un autre utilisateur'
          using errcode = '23P01';
      end if;

      begin
        update public.calendar_occupations
        set cancelled_at = null,
            updated_at = now(),
            updated_by = auth.uid()
        where id = target_occupation_id;
      exception
        when exclusion_violation then
          raise exception 'Ce créneau a déjà été repris par un autre utilisateur'
            using errcode = '23P01';
      end;
    end if;

    update public.permanent_slot_occurrences
    set status = next_status,
        confirmed_at = case
          when next_status = 'confirmed' then now()
          else null
        end,
        confirmed_by = case
          when next_status = 'confirmed' then auth.uid()
          else null
        end,
        released_at = null,
        released_by = null,
        updated_at = now()
    where id = target_occurrence_id;
  end if;

  insert into public.permanent_slot_audit_log (
    permanent_slot_id,
    occurrence_id,
    action,
    actor_id,
    previous_status,
    new_status
  ) values (
    target_slot_id,
    target_occurrence_id,
    'occurrence_status_changed',
    auth.uid(),
    current_status,
    next_status
  );
end;
$$;

revoke all on function public.set_my_permanent_slot_occurrence_status(uuid, text)
from public, anon, authenticated;
grant execute on function public.set_my_permanent_slot_occurrence_status(uuid, text)
to authenticated;

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
  released_permanent_at timestamptz;
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
  with base_slots as (
    select
      slot.resource_id,
      slot.starts_at,
      slot.ends_at,
      slot.status,
      slot.booking_opens_at,
      slot.booked_by_name,
      false as is_permanent_release
    from public.list_available_slots(
      target_resource_id,
      range_start,
      range_end
    ) as slot
  ),
  released_slots as (
    select
      slot.resource_id,
      private_occupation.starts_at,
      private_occupation.ends_at,
      'available'::text as status,
      occurrence.released_at as booking_opens_at,
      null::text as booked_by_name,
      true as is_permanent_release
    from public.permanent_slot_occurrences as occurrence
    join public.permanent_slots as slot
      on slot.id = occurrence.permanent_slot_id
     and slot.is_active
    join public.calendar_occupations as private_occupation
      on private_occupation.id = occurrence.occupation_id
    where slot.resource_id = target_resource_id
      and occurrence.status = 'released'::public.permanent_slot_occurrence_status
      and occurrence.occurrence_date between range_start and range_end
      and not exists (
        select 1
        from public.calendar_occupations as active_occupation
        where active_occupation.resource_id = slot.resource_id
          and active_occupation.id <> occurrence.occupation_id
          and active_occupation.cancelled_at is null
          and tstzrange(active_occupation.starts_at, active_occupation.ends_at, '[)')
            && tstzrange(private_occupation.starts_at, private_occupation.ends_at, '[)')
      )
      and not exists (
        select 1
        from base_slots as base_slot
        where base_slot.resource_id = slot.resource_id
          and base_slot.starts_at = private_occupation.starts_at
          and base_slot.ends_at = private_occupation.ends_at
      )
  ),
  all_slots as (
    select * from base_slots
    union all
    select * from released_slots
  )
  select
    slot.resource_id,
    slot.starts_at,
    slot.ends_at,
    slot.status,
    slot.booking_opens_at,
    slot.booked_by_name,
    coalesce(
      metadata.occupation_type,
      case when slot.is_permanent_release then 'permanent_release' end
    ) as occupation_type,
    metadata.display_color,
    case when access.is_priority then 'championship' else 'standard' end
      as reservation_access
  from all_slots as slot
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
  where coalesce(metadata.occupation_type, '') <> 'private_use'
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots_v2(uuid, date, date)
from public;
grant execute on function public.list_available_slots_v2(uuid, date, date)
to anon, authenticated;

commit;
