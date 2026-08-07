create type public.tournament_status as enum (
  'preparation',
  'configuration',
  'registrations_open',
  'registrations_closed',
  'pools_generated',
  'pools_validated',
  'planning_generated',
  'planning_published',
  'in_progress',
  'completed',
  'archived',
  'cancelled'
);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  season_id uuid not null references public.club_seasons (id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  rules text not null default '',
  starts_on date not null,
  ends_on date not null,
  registration_opens_at timestamptz not null,
  registration_closes_at timestamptz not null,
  status public.tournament_status not null default 'preparation',
  timezone text not null default 'Europe/Paris',
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (registration_closes_at > registration_opens_at),
  unique (club_id, season_id, name)
);

create table public.tournament_resources (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  resource_id uuid not null references public.reservable_resources (id) on delete restrict,
  display_order integer not null default 0 check (display_order >= 0),
  primary key (tournament_id, resource_id)
);

create table public.tournament_series (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  display_order integer not null default 0 check (display_order >= 0),
  capacity integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  check (capacity >= 0 and (not enabled or capacity > 0))
);

create unique index tournament_series_name_unique
on public.tournament_series (tournament_id, lower(name));

create table public.tournament_play_windows (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  check (closes_at > opens_at),
  unique (tournament_id, weekday, opens_at, closes_at)
);

create table public.tournament_audit_log (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  action text not null check (btrim(action) <> ''),
  before_status public.tournament_status,
  after_status public.tournament_status,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index tournaments_club_status_idx
on public.tournaments (club_id, status, starts_on);
create index tournament_resources_tournament_idx
on public.tournament_resources (tournament_id, display_order);
create index tournament_series_tournament_idx
on public.tournament_series (tournament_id, display_order);
create index tournament_play_windows_tournament_idx
on public.tournament_play_windows (tournament_id, weekday, opens_at);
create index tournament_audit_tournament_idx
on public.tournament_audit_log (tournament_id, created_at desc);

alter table public.tournaments enable row level security;
alter table public.tournament_resources enable row level security;
alter table public.tournament_series enable row level security;
alter table public.tournament_play_windows enable row level security;
alter table public.tournament_audit_log enable row level security;

revoke all on table public.tournaments from public, anon, authenticated;
revoke all on table public.tournament_resources from public, anon, authenticated;
revoke all on table public.tournament_series from public, anon, authenticated;
revoke all on table public.tournament_play_windows from public, anon, authenticated;
revoke all on table public.tournament_audit_log from public, anon, authenticated;

create or replace function public.tournament_configuration_is_complete(target_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
      and exists (
        select 1
        from public.tournament_resources as selected
        join public.reservable_resources as resource
          on resource.id = selected.resource_id
         and resource.club_id = tournament.club_id
         and resource.is_active
        where selected.tournament_id = tournament.id
      )
      and exists (
        select 1
        from public.tournament_series as series
        where series.tournament_id = tournament.id
          and series.enabled
          and series.capacity > 0
      )
      and exists (
        select 1
        from public.tournament_play_windows as play_window
        where play_window.tournament_id = tournament.id
      )
  );
$$;

create or replace function public.sync_tournament_registration_states(target_club_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with opened as (
    update public.tournaments as tournament
    set
      status = 'registrations_open',
      updated_at = now(),
      updated_by = null
    where tournament.club_id = target_club_id
      and tournament.status = 'configuration'
      and tournament.registration_opens_at <= now()
      and tournament.registration_closes_at > now()
      and public.tournament_configuration_is_complete(tournament.id)
    returning tournament.id
  )
  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  select
    opened.id,
    'registrations_opened_automatically',
    'configuration',
    'registrations_open',
    '{}'::jsonb,
    null
  from opened;

  with closed as (
    update public.tournaments as tournament
    set
      status = 'registrations_closed',
      updated_at = now(),
      updated_by = null
    where tournament.club_id = target_club_id
      and tournament.status = 'registrations_open'
      and tournament.registration_closes_at <= now()
    returning tournament.id
  )
  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  select
    closed.id,
    'registrations_closed_automatically',
    'registrations_open',
    'registrations_closed',
    '{}'::jsonb,
    null
  from closed;
end;
$$;

revoke all on function public.tournament_configuration_is_complete(uuid) from public, anon, authenticated;
revoke all on function public.sync_tournament_registration_states(uuid) from public, anon, authenticated;

create or replace function public.admin_get_tournament_options()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'seasons', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', season.id,
            'name', season.name,
            'starts_on', season.starts_on,
            'ends_on', season.ends_on,
            'is_active', season.is_active
          )
          order by season.is_active desc, season.starts_on desc
        ),
        '[]'::jsonb
      )
      from public.club_seasons as season
      where season.club_id = target_club_id
    ),
    'resources', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', resource.id,
            'name', resource.name
          )
          order by resource.name
        ),
        '[]'::jsonb
      )
      from public.reservable_resources as resource
      where resource.club_id = target_club_id
        and resource.is_active
    )
  );
end;
$$;

create or replace function public.admin_list_tournaments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  perform public.sync_tournament_registration_states(target_club_id);

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', tournament.id,
          'name', tournament.name,
          'season_id', tournament.season_id,
          'season_name', season.name,
          'starts_on', tournament.starts_on,
          'ends_on', tournament.ends_on,
          'registration_opens_at', tournament.registration_opens_at,
          'registration_closes_at', tournament.registration_closes_at,
          'status', tournament.status,
          'series_count', (
            select count(*)
            from public.tournament_series as series
            where series.tournament_id = tournament.id
          ),
          'resource_count', (
            select count(*)
            from public.tournament_resources as selected
            where selected.tournament_id = tournament.id
          ),
          'updated_at', tournament.updated_at
        )
        order by tournament.starts_on desc, tournament.name
      ),
      '[]'::jsonb
    )
    from public.tournaments as tournament
    join public.club_seasons as season on season.id = tournament.season_id
    where tournament.club_id = target_club_id
  );
end;
$$;

create or replace function public.admin_get_tournament(target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  result jsonb;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  perform public.sync_tournament_registration_states(target_club_id);

  select jsonb_build_object(
    'id', tournament.id,
    'name', tournament.name,
    'season_id', tournament.season_id,
    'season_name', season.name,
    'description', tournament.description,
    'rules', tournament.rules,
    'starts_on', tournament.starts_on,
    'ends_on', tournament.ends_on,
    'registration_opens_at', tournament.registration_opens_at,
    'registration_closes_at', tournament.registration_closes_at,
    'status', tournament.status,
    'timezone', tournament.timezone,
    'resources', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', resource.id,
            'name', resource.name,
            'display_order', selected.display_order
          )
          order by selected.display_order, resource.name
        ),
        '[]'::jsonb
      )
      from public.tournament_resources as selected
      join public.reservable_resources as resource on resource.id = selected.resource_id
      where selected.tournament_id = tournament.id
    ),
    'series', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', series.id,
            'name', series.name,
            'display_order', series.display_order,
            'capacity', series.capacity,
            'enabled', series.enabled
          )
          order by series.display_order, series.name
        ),
        '[]'::jsonb
      )
      from public.tournament_series as series
      where series.tournament_id = tournament.id
    ),
    'play_windows', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', play_window.id,
            'weekday', play_window.weekday,
            'opens_at', play_window.opens_at,
            'closes_at', play_window.closes_at,
            'display_order', play_window.display_order
          )
          order by play_window.display_order, play_window.weekday, play_window.opens_at
        ),
        '[]'::jsonb
      )
      from public.tournament_play_windows as play_window
      where play_window.tournament_id = tournament.id
    ),
    'created_at', tournament.created_at,
    'updated_at', tournament.updated_at
  )
  into result
  from public.tournaments as tournament
  join public.club_seasons as season on season.id = tournament.season_id
  where tournament.id = target_id
    and tournament.club_id = target_club_id;

  if result is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function public.admin_create_tournament(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_id uuid;
  target_season_id uuid := nullif(payload->>'season_id', '')::uuid;
  target_name text := btrim(coalesce(payload->>'name', ''));
  target_starts_on date := nullif(payload->>'starts_on', '')::date;
  target_ends_on date := nullif(payload->>'ends_on', '')::date;
  target_registration_opens_at timestamptz := nullif(payload->>'registration_opens_at', '')::timestamptz;
  target_registration_closes_at timestamptz := nullif(payload->>'registration_closes_at', '')::timestamptz;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if target_name = ''
    or target_season_id is null
    or target_starts_on is null
    or target_ends_on is null
    or target_registration_opens_at is null
    or target_registration_closes_at is null then
    raise exception 'Tournament fields are incomplete' using errcode = '22023';
  end if;

  if target_ends_on < target_starts_on then
    raise exception 'Tournament dates are invalid' using errcode = '22023';
  end if;

  if target_registration_closes_at <= target_registration_opens_at then
    raise exception 'Registration dates are invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.club_seasons as season
    where season.id = target_season_id
      and season.club_id = target_club_id
      and season.starts_on <= target_starts_on
      and season.ends_on >= target_ends_on
  ) then
    raise exception 'Tournament must fit inside its season' using errcode = '22023';
  end if;

  insert into public.tournaments (
    club_id,
    season_id,
    name,
    description,
    rules,
    starts_on,
    ends_on,
    registration_opens_at,
    registration_closes_at,
    created_by,
    updated_by
  )
  values (
    target_club_id,
    target_season_id,
    target_name,
    coalesce(payload->>'description', ''),
    coalesce(payload->>'rules', ''),
    target_starts_on,
    target_ends_on,
    target_registration_opens_at,
    target_registration_closes_at,
    auth.uid(),
    auth.uid()
  )
  returning id into target_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    after_status,
    payload,
    created_by
  )
  values (
    target_id,
    'created',
    'preparation',
    jsonb_build_object('name', target_name),
    auth.uid()
  );

  return target_id;
end;
$$;

create or replace function public.admin_update_tournament(target_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  current_tournament public.tournaments;
  target_season_id uuid := nullif(payload->>'season_id', '')::uuid;
  target_name text := btrim(coalesce(payload->>'name', ''));
  target_starts_on date := nullif(payload->>'starts_on', '')::date;
  target_ends_on date := nullif(payload->>'ends_on', '')::date;
  target_registration_opens_at timestamptz := nullif(payload->>'registration_opens_at', '')::timestamptz;
  target_registration_closes_at timestamptz := nullif(payload->>'registration_closes_at', '')::timestamptz;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into current_tournament
  from public.tournaments as tournament
  where tournament.id = target_id
    and tournament.club_id = target_club_id
  for update;

  if current_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if current_tournament.status not in ('preparation', 'configuration') then
    raise exception 'Tournament settings are locked at this stage' using errcode = 'P0001';
  end if;

  if target_name = ''
    or target_season_id is null
    or target_starts_on is null
    or target_ends_on is null
    or target_registration_opens_at is null
    or target_registration_closes_at is null then
    raise exception 'Tournament fields are incomplete' using errcode = '22023';
  end if;

  if target_ends_on < target_starts_on
    or target_registration_closes_at <= target_registration_opens_at then
    raise exception 'Tournament dates are invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.club_seasons as season
    where season.id = target_season_id
      and season.club_id = target_club_id
      and season.starts_on <= target_starts_on
      and season.ends_on >= target_ends_on
  ) then
    raise exception 'Tournament must fit inside its season' using errcode = '22023';
  end if;

  update public.tournaments
  set
    season_id = target_season_id,
    name = target_name,
    description = coalesce(payload->>'description', ''),
    rules = coalesce(payload->>'rules', ''),
    starts_on = target_starts_on,
    ends_on = target_ends_on,
    registration_opens_at = target_registration_opens_at,
    registration_closes_at = target_registration_closes_at,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_id,
    'updated',
    current_tournament.status,
    current_tournament.status,
    jsonb_build_object('name', target_name),
    auth.uid()
  );
end;
$$;

create or replace function public.admin_save_tournament_configuration(target_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  current_tournament public.tournaments;
  resource_ids jsonb := coalesce(payload->'resource_ids', '[]'::jsonb);
  series_values jsonb := coalesce(payload->'series', '[]'::jsonb);
  play_window_values jsonb := coalesce(payload->'play_windows', '[]'::jsonb);
  requested_resource_count integer;
  distinct_resource_count integer;
  valid_resource_count integer;
  item jsonb;
  item_index integer := 0;
  item_name text;
  item_capacity integer;
  item_enabled boolean;
  item_weekday integer;
  item_opens_at time;
  item_closes_at time;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into current_tournament
  from public.tournaments as tournament
  where tournament.id = target_id
    and tournament.club_id = target_club_id
  for update;

  if current_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if current_tournament.status not in ('preparation', 'configuration') then
    raise exception 'Tournament configuration is locked at this stage' using errcode = 'P0001';
  end if;

  if jsonb_typeof(resource_ids) <> 'array'
    or jsonb_typeof(series_values) <> 'array'
    or jsonb_typeof(play_window_values) <> 'array' then
    raise exception 'Tournament configuration is invalid' using errcode = '22023';
  end if;

  select count(*), count(distinct value)
  into requested_resource_count, distinct_resource_count
  from jsonb_array_elements_text(resource_ids);

  if requested_resource_count <> distinct_resource_count then
    raise exception 'A resource can only be selected once' using errcode = '22023';
  end if;

  select count(*)
  into valid_resource_count
  from public.reservable_resources as resource
  where resource.club_id = target_club_id
    and resource.is_active
    and resource.id in (
      select value::uuid
      from jsonb_array_elements_text(resource_ids)
    );

  if valid_resource_count <> requested_resource_count then
    raise exception 'One or more resources are invalid' using errcode = '22023';
  end if;

  delete from public.tournament_resources
  where tournament_id = target_id;

  insert into public.tournament_resources (tournament_id, resource_id, display_order)
  select
    target_id,
    value::uuid,
    (ordinality - 1)::integer
  from jsonb_array_elements_text(resource_ids) with ordinality as resources(value, ordinality);

  delete from public.tournament_series
  where tournament_id = target_id;

  item_index := 0;
  for item in select value from jsonb_array_elements(series_values)
  loop
    item_name := btrim(coalesce(item->>'name', ''));
    item_capacity := coalesce(nullif(item->>'capacity', '')::integer, 0);
    item_enabled := coalesce(nullif(item->>'enabled', '')::boolean, true);

    if item_name = '' or item_capacity < 0 or (item_enabled and item_capacity = 0) then
      raise exception 'Tournament series are invalid' using errcode = '22023';
    end if;

    insert into public.tournament_series (
      tournament_id,
      name,
      display_order,
      capacity,
      enabled
    )
    values (
      target_id,
      item_name,
      coalesce(nullif(item->>'display_order', '')::integer, item_index),
      item_capacity,
      item_enabled
    );

    item_index := item_index + 1;
  end loop;

  delete from public.tournament_play_windows
  where tournament_id = target_id;

  item_index := 0;
  for item in select value from jsonb_array_elements(play_window_values)
  loop
    item_weekday := nullif(item->>'weekday', '')::integer;
    item_opens_at := nullif(item->>'opens_at', '')::time;
    item_closes_at := nullif(item->>'closes_at', '')::time;

    if item_weekday is null
      or item_weekday < 0
      or item_weekday > 6
      or item_opens_at is null
      or item_closes_at is null
      or item_closes_at <= item_opens_at then
      raise exception 'Tournament play windows are invalid' using errcode = '22023';
    end if;

    insert into public.tournament_play_windows (
      tournament_id,
      weekday,
      opens_at,
      closes_at,
      display_order
    )
    values (
      target_id,
      item_weekday,
      item_opens_at,
      item_closes_at,
      coalesce(nullif(item->>'display_order', '')::integer, item_index)
    );

    item_index := item_index + 1;
  end loop;

  update public.tournaments
  set
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_id,
    'configuration_saved',
    current_tournament.status,
    current_tournament.status,
    jsonb_build_object(
      'resource_count', requested_resource_count,
      'series_count', jsonb_array_length(series_values),
      'play_window_count', jsonb_array_length(play_window_values)
    ),
    auth.uid()
  );
end;
$$;

create or replace function public.admin_transition_tournament(
  target_id uuid,
  target_status public.tournament_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  current_tournament public.tournaments;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into current_tournament
  from public.tournaments as tournament
  where tournament.id = target_id
    and tournament.club_id = target_club_id
  for update;

  if current_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_status = 'configuration' then
    if current_tournament.status <> 'preparation' then
      raise exception 'Invalid tournament transition' using errcode = 'P0001';
    end if;
    if not public.tournament_configuration_is_complete(target_id) then
      raise exception 'Complete resources, series and play windows first' using errcode = 'P0001';
    end if;
  elsif target_status = 'registrations_open' then
    if current_tournament.status <> 'configuration' then
      raise exception 'Invalid tournament transition' using errcode = 'P0001';
    end if;
    if not public.tournament_configuration_is_complete(target_id) then
      raise exception 'Tournament configuration is incomplete' using errcode = 'P0001';
    end if;
    if now() < current_tournament.registration_opens_at
      or now() >= current_tournament.registration_closes_at then
      raise exception 'Registration window is not open' using errcode = 'P0001';
    end if;
  elsif target_status = 'registrations_closed' then
    if current_tournament.status <> 'registrations_open' then
      raise exception 'Invalid tournament transition' using errcode = 'P0001';
    end if;
  elsif target_status = 'cancelled' then
    if current_tournament.status not in (
      'preparation',
      'configuration',
      'registrations_open',
      'registrations_closed'
    ) then
      raise exception 'Tournament cannot be cancelled by the core engine at this stage' using errcode = 'P0001';
    end if;
  else
    raise exception 'Transition belongs to a future tournament engine' using errcode = 'P0001';
  end if;

  update public.tournaments
  set
    status = target_status,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_id,
    'status_changed',
    current_tournament.status,
    target_status,
    '{}'::jsonb,
    auth.uid()
  );
end;
$$;

revoke all on function public.admin_get_tournament_options() from public;
revoke all on function public.admin_list_tournaments() from public;
revoke all on function public.admin_get_tournament(uuid) from public;
revoke all on function public.admin_create_tournament(jsonb) from public;
revoke all on function public.admin_update_tournament(uuid, jsonb) from public;
revoke all on function public.admin_save_tournament_configuration(uuid, jsonb) from public;
revoke all on function public.admin_transition_tournament(uuid, public.tournament_status) from public;

grant execute on function public.admin_get_tournament_options() to authenticated;
grant execute on function public.admin_list_tournaments() to authenticated;
grant execute on function public.admin_get_tournament(uuid) to authenticated;
grant execute on function public.admin_create_tournament(jsonb) to authenticated;
grant execute on function public.admin_update_tournament(uuid, jsonb) to authenticated;
grant execute on function public.admin_save_tournament_configuration(uuid, jsonb) to authenticated;
grant execute on function public.admin_transition_tournament(uuid, public.tournament_status) to authenticated;
