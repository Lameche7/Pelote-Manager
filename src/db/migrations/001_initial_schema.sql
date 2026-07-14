-- Migration 001: Initial schema for Pelote Manager
-- Creates all tables with Row Level Security enabled

-- ─── Extensions ────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";

-- ─── Enums ─────────────────────────────────────────────────────────────────

create type public.match_status as enum (
  'scheduled',
  'in_progress',
  'completed',
  'cancelled'
);

create type public.tournament_phase as enum (
  'registration',
  'pools',
  'planning',
  'in_progress',
  'finished'
);

-- ─── Tournament Settings ────────────────────────────────────────────────────

create table public.tournament_settings (
  id                      uuid primary key default uuid_generate_v4(),
  name                    text not null,
  location                text not null default '',
  start_date              date not null,
  end_date                date not null,
  number_of_weeks         integer not null default 1 check (number_of_weeks > 0),
  time_slots              text[] not null default '{}',
  number_of_courts        integer not null default 1 check (number_of_courts > 0),
  match_duration_minutes  integer not null default 45 check (match_duration_minutes > 0),
  day_start_time          time not null default '09:00',
  day_end_time            time not null default '20:00',
  playable_days           integer[] not null default '{1,2,3,4,5,6}',
  registration_open       boolean not null default false,
  registration_deadline   date,
  phase                   public.tournament_phase not null default 'registration',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.tournament_settings enable row level security;

-- Only authenticated admins can write; public can read
create policy "Public read tournament settings"
  on public.tournament_settings for select using (true);

create policy "Admins manage tournament settings"
  on public.tournament_settings for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── Series ────────────────────────────────────────────────────────────────

create table public.series (
  id            uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournament_settings(id) on delete cascade,
  name          text not null,
  "order"       integer not null default 0,
  max_teams     integer not null default 0 check (max_teams >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.series enable row level security;

create policy "Public read series"
  on public.series for select using (true);

create policy "Admins manage series"
  on public.series for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── Teams ─────────────────────────────────────────────────────────────────

create table public.teams (
  id            uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournament_settings(id) on delete cascade,
  series_id     uuid not null references public.series(id) on delete restrict,
  player1_name  text not null,
  player2_name  text not null,
  phone         text,
  email         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.teams enable row level security;

create policy "Public read teams"
  on public.teams for select using (true);

create policy "Admins manage teams"
  on public.teams for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── Team Availabilities ───────────────────────────────────────────────────

create table public.team_availabilities (
  id           uuid primary key default uuid_generate_v4(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  day_of_week  integer not null check (day_of_week between 0 and 6),
  start_time   time not null,
  end_time     time not null,
  constraint valid_time_range check (end_time > start_time)
);

alter table public.team_availabilities enable row level security;

create policy "Public read team availabilities"
  on public.team_availabilities for select using (true);

create policy "Admins manage team availabilities"
  on public.team_availabilities for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── Pools ─────────────────────────────────────────────────────────────────

create table public.pools (
  id            uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournament_settings(id) on delete cascade,
  series_id     uuid not null references public.series(id) on delete cascade,
  name          text not null,
  validated     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.pools enable row level security;

create policy "Public read pools"
  on public.pools for select using (true);

create policy "Admins manage pools"
  on public.pools for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── Pool Teams ────────────────────────────────────────────────────────────

create table public.pool_teams (
  id      uuid primary key default uuid_generate_v4(),
  pool_id uuid not null references public.pools(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  unique (pool_id, team_id)
);

alter table public.pool_teams enable row level security;

create policy "Public read pool teams"
  on public.pool_teams for select using (true);

create policy "Admins manage pool teams"
  on public.pool_teams for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── Courts ────────────────────────────────────────────────────────────────

create table public.courts (
  id            uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null references public.tournament_settings(id) on delete cascade,
  name          text not null,
  number        integer not null
);

alter table public.courts enable row level security;

create policy "Public read courts"
  on public.courts for select using (true);

create policy "Admins manage courts"
  on public.courts for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── Matches ───────────────────────────────────────────────────────────────

create table public.matches (
  id             uuid primary key default uuid_generate_v4(),
  tournament_id  uuid not null references public.tournament_settings(id) on delete cascade,
  pool_id        uuid not null references public.pools(id) on delete cascade,
  team_a_id      uuid not null references public.teams(id) on delete cascade,
  team_b_id      uuid not null references public.teams(id) on delete cascade,
  court_id       uuid references public.courts(id) on delete set null,
  scheduled_date date,
  scheduled_time time,
  score_a        integer check (score_a >= 0),
  score_b        integer check (score_b >= 0),
  sets_a         integer check (sets_a >= 0),
  sets_b         integer check (sets_b >= 0),
  status         public.match_status not null default 'scheduled',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint different_teams check (team_a_id != team_b_id)
);

alter table public.matches enable row level security;

create policy "Public read matches"
  on public.matches for select using (true);

create policy "Admins manage matches"
  on public.matches for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── Reservations ──────────────────────────────────────────────────────────

create table public.reservations (
  id          uuid primary key default uuid_generate_v4(),
  court_id    uuid not null references public.courts(id) on delete cascade,
  user_name   text not null,
  user_email  text,
  user_phone  text,
  date        date not null,
  start_time  time not null,
  end_time    time not null,
  created_at  timestamptz not null default now(),
  constraint valid_reservation_time check (end_time > start_time)
);

alter table public.reservations enable row level security;

create policy "Public read reservations"
  on public.reservations for select using (true);

create policy "Anyone can create reservation"
  on public.reservations for insert with check (true);

create policy "Admins manage reservations"
  on public.reservations for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── Updated At Trigger ────────────────────────────────────────────────────

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on public.tournament_settings
  for each row execute function public.handle_updated_at();

create trigger set_updated_at
  before update on public.series
  for each row execute function public.handle_updated_at();

create trigger set_updated_at
  before update on public.teams
  for each row execute function public.handle_updated_at();

create trigger set_updated_at
  before update on public.pools
  for each row execute function public.handle_updated_at();

create trigger set_updated_at
  before update on public.matches
  for each row execute function public.handle_updated_at();
