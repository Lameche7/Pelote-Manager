create table public.club_tv_settings (
  club_id uuid primary key references public.clubs (id) on delete cascade,
  is_enabled boolean not null default false,
  display_start_time time not null default '08:00',
  display_end_time time not null default '23:00',
  visible_slot_count integer not null default 8
    check (visible_slot_count between 1 and 24),
  refresh_interval_seconds integer not null default 30
    check (refresh_interval_seconds in (15, 30, 60, 120, 300)),
  public_token uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  check (display_end_time > display_start_time)
);

create unique index club_tv_settings_public_token_unique
on public.club_tv_settings (public_token);

create table public.club_tv_resources (
  club_id uuid not null references public.club_tv_settings (club_id) on delete cascade,
  resource_id uuid not null references public.reservable_resources (id) on delete cascade,
  display_order integer not null check (display_order >= 0),
  primary key (club_id, resource_id),
  unique (club_id, display_order)
);

create table public.club_tv_settings_audit_log (
  id bigint generated always as identity primary key,
  club_id uuid not null references public.clubs (id) on delete cascade,
  action text not null check (action in ('updated', 'token_rotated')),
  actor_id uuid references public.profiles (id) on delete set null,
  previous_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index club_tv_settings_audit_club_created_idx
on public.club_tv_settings_audit_log (club_id, created_at desc);

insert into public.club_tv_settings (club_id)
select clubs.id
from public.clubs
on conflict (club_id) do nothing;

create function public.admin_get_tv_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  club uuid := public.admin_current_club_id();
  settings public.club_tv_settings;
begin
  if not public.has_club_permission(club, 'settings.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select *
  into settings
  from public.club_tv_settings
  where club_id = club;

  if settings.club_id is null then
    raise exception 'Paramètres du Mode TV introuvables' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'is_enabled', settings.is_enabled,
    'display_start_time', to_char(settings.display_start_time, 'HH24:MI'),
    'display_end_time', to_char(settings.display_end_time, 'HH24:MI'),
    'visible_slot_count', settings.visible_slot_count,
    'refresh_interval_seconds', settings.refresh_interval_seconds,
    'public_token', settings.public_token,
    'resources', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', resources.id,
            'name', resources.name,
            'selected', selected_resources.resource_id is not null,
            'display_order', selected_resources.display_order
          )
          order by
            coalesce(selected_resources.display_order, 2147483647),
            resources.name
        )
        from public.reservable_resources resources
        left join public.club_tv_resources selected_resources
          on selected_resources.club_id = club
         and selected_resources.resource_id = resources.id
        where resources.club_id = club
          and resources.is_active
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create function public.admin_save_tv_settings(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  club uuid := public.admin_current_club_id();
  previous_settings public.club_tv_settings;
  saved_settings public.club_tv_settings;
  previous_resource_ids uuid[];
  selected_resource_ids uuid[];
  target_enabled boolean := coalesce((payload ->> 'is_enabled')::boolean, false);
  target_start time := coalesce(
    nullif(payload ->> 'display_start_time', '')::time,
    '08:00'::time
  );
  target_end time := coalesce(
    nullif(payload ->> 'display_end_time', '')::time,
    '23:00'::time
  );
  target_slot_count integer := coalesce((payload ->> 'visible_slot_count')::integer, 8);
  target_refresh integer := coalesce((payload ->> 'refresh_interval_seconds')::integer, 30);
begin
  if not public.has_club_permission(club, 'settings.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select coalesce(array_agg(items.value::uuid order by items.ordinality), '{}'::uuid[])
  into selected_resource_ids
  from jsonb_array_elements_text(
    coalesce(payload -> 'resource_ids', '[]'::jsonb)
  ) with ordinality as items(value, ordinality);

  if target_end <= target_start then
    raise exception 'La fin de la plage TV doit suivre son début' using errcode = '22023';
  end if;

  if target_slot_count not between 1 and 24 then
    raise exception 'Le nombre de créneaux doit être compris entre 1 et 24' using errcode = '22023';
  end if;

  if target_refresh not in (15, 30, 60, 120, 300) then
    raise exception 'Fréquence d’actualisation invalide' using errcode = '22023';
  end if;

  if target_enabled and cardinality(selected_resource_ids) = 0 then
    raise exception 'Sélectionnez au moins un terrain avant d’activer le Mode TV' using errcode = '22023';
  end if;

  if cardinality(selected_resource_ids) <>
    (select count(distinct ids.id) from unnest(selected_resource_ids) ids(id))
  then
    raise exception 'Un terrain ne peut être sélectionné qu’une fois' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(selected_resource_ids) ids(id)
    where not exists (
      select 1
      from public.reservable_resources resources
      where resources.id = ids.id
        and resources.club_id = club
        and resources.is_active
    )
  ) then
    raise exception 'Un terrain sélectionné est invalide ou inactif' using errcode = '22023';
  end if;

  insert into public.club_tv_settings (club_id)
  values (club)
  on conflict (club_id) do nothing;

  select *
  into previous_settings
  from public.club_tv_settings
  where club_id = club
  for update;

  select array_agg(resources.resource_id order by resources.display_order)
  into previous_resource_ids
  from public.club_tv_resources resources
  where resources.club_id = club;

  update public.club_tv_settings
  set is_enabled = target_enabled,
      display_start_time = target_start,
      display_end_time = target_end,
      visible_slot_count = target_slot_count,
      refresh_interval_seconds = target_refresh,
      updated_at = now(),
      updated_by = auth.uid()
  where club_id = club
  returning * into saved_settings;

  delete from public.club_tv_resources
  where club_id = club;

  insert into public.club_tv_resources (club_id, resource_id, display_order)
  select club, selected.id, (selected.ordinality - 1)::integer
  from unnest(selected_resource_ids) with ordinality as selected(id, ordinality);

  insert into public.club_tv_settings_audit_log (
    club_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    club,
    'updated',
    auth.uid(),
    to_jsonb(previous_settings)
      || jsonb_build_object('resource_ids', coalesce(previous_resource_ids, '{}'::uuid[])),
    to_jsonb(saved_settings)
      || jsonb_build_object('resource_ids', selected_resource_ids)
  );
end;
$$;

create function public.admin_rotate_tv_token()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  club uuid := public.admin_current_club_id();
  previous_settings public.club_tv_settings;
  saved_settings public.club_tv_settings;
begin
  if not public.has_club_permission(club, 'settings.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  insert into public.club_tv_settings (club_id)
  values (club)
  on conflict (club_id) do nothing;

  select *
  into previous_settings
  from public.club_tv_settings
  where club_id = club
  for update;

  update public.club_tv_settings
  set public_token = gen_random_uuid(),
      updated_at = now(),
      updated_by = auth.uid()
  where club_id = club
  returning * into saved_settings;

  insert into public.club_tv_settings_audit_log (
    club_id,
    action,
    actor_id,
    previous_data,
    new_data
  ) values (
    club,
    'token_rotated',
    auth.uid(),
    jsonb_build_object('public_token', previous_settings.public_token),
    jsonb_build_object('public_token', saved_settings.public_token)
  );

  return saved_settings.public_token;
end;
$$;

alter table public.club_tv_settings enable row level security;
alter table public.club_tv_resources enable row level security;
alter table public.club_tv_settings_audit_log enable row level security;

revoke all on table public.club_tv_settings from public, anon, authenticated;
revoke all on table public.club_tv_resources from public, anon, authenticated;
revoke all on table public.club_tv_settings_audit_log from public, anon, authenticated;

revoke all on function public.admin_get_tv_settings() from public;
revoke all on function public.admin_save_tv_settings(jsonb) from public;
revoke all on function public.admin_rotate_tv_token() from public;

grant execute on function public.admin_get_tv_settings() to authenticated;
grant execute on function public.admin_save_tv_settings(jsonb) to authenticated;
grant execute on function public.admin_rotate_tv_token() to authenticated;
