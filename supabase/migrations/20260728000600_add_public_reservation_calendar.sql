create table public.resource_opening_hours (
  id bigint generated always as identity primary key,
  resource_id uuid not null references public.reservable_resources (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resource_opening_hours_valid_period check (closes_at > opens_at),
  constraint resource_opening_hours_unique_period unique (
    resource_id,
    weekday,
    opens_at,
    closes_at
  )
);

create index resource_opening_hours_resource_weekday_idx
on public.resource_opening_hours (resource_id, weekday)
where is_open;

alter table public.resource_opening_hours enable row level security;

create policy resource_opening_hours_public_read
on public.resource_opening_hours
for select
to anon, authenticated
using (is_open);

create function public.list_calendar_occupations(
  target_resource_id uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns table (
  id uuid,
  occupation_type public.occupation_type,
  title text,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    occupation.id,
    occupation.occupation_type,
    occupation.title,
    occupation.starts_at,
    occupation.ends_at
  from public.calendar_occupations as occupation
  join public.reservable_resources as resource
    on resource.id = occupation.resource_id
  where occupation.resource_id = target_resource_id
    and resource.is_active
    and occupation.cancelled_at is null
    and occupation.starts_at < range_end
    and occupation.ends_at > range_start
  order by occupation.starts_at;
$$;

revoke all on function public.list_calendar_occupations(uuid, timestamptz, timestamptz)
from public;
grant execute on function public.list_calendar_occupations(uuid, timestamptz, timestamptz)
to anon, authenticated;

create function public.list_available_slots(
  target_resource_id uuid,
  range_start date,
  range_end date
)
returns table (
  resource_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  with resource_config as (
    select
      resource.id,
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
  opening_periods as (
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
  generated_slots as (
    select
      period.resource_id,
      (
        slot_local at time zone period.timezone
      ) as starts_at,
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
  )
  select
    slot.resource_id,
    slot.starts_at,
    slot.ends_at,
    case
      when exists (
        select 1
        from public.calendar_occupations as occupation
        where occupation.resource_id = slot.resource_id
          and occupation.cancelled_at is null
          and occupation.starts_at < slot.ends_at
          and occupation.ends_at > slot.starts_at
      ) then 'occupied'
      else 'available'
    end as status
  from generated_slots as slot
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots(uuid, date, date) from public;
grant execute on function public.list_available_slots(uuid, date, date)
to anon, authenticated;
