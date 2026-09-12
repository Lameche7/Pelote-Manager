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

commit;
