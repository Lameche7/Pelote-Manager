-- Ephemeral CI only: extend the existing empty slot-source fixtures for planning tests.
alter table public.tournament_matches
  add column pool_id uuid references public.tournament_pools(id),
  add column series_id uuid references public.tournament_series(id),
  add column team_a_id uuid references public.tournament_teams(id),
  add column team_b_id uuid references public.tournament_teams(id),
  add column display_order integer not null default 0,
  add column status text not null default 'to_schedule',
  add column updated_at timestamptz not null default now(),
  alter column phase set default 'pools',
  add unique(pool_id,team_a_id,team_b_id),
  add unique(pool_id,display_order);
alter table public.tournament_match_planning
  add column tournament_id uuid references public.tournaments(id),
  add column resource_id uuid references public.reservable_resources(id),
  add column source text not null default 'generated',
  add column updated_at timestamptz not null default now(),
  add primary key(match_id),
  add unique(tournament_id,resource_id,play_date,starts_at);
alter table public.tournament_series add column if not exists color text not null default '#2563EB';
create table public.events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  color text,
  updated_by uuid,
  updated_at timestamptz
);
create table public.tournament_match_events (
  match_id uuid not null references public.tournament_matches(id),
  event_id uuid not null references public.events(id)
);
