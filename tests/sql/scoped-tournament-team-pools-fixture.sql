-- Ephemeral CI only: historical pool and assignment relations.
create table public.tournament_pools (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  series_id uuid not null references public.tournament_series (id) on delete cascade,
  display_order integer not null check (display_order >= 0),
  target_size smallint not null check (target_size in (4, 5, 6)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, series_id, display_order)
);

create table public.tournament_pool_teams (
  pool_id uuid not null references public.tournament_pools (id) on delete cascade,
  team_id uuid not null references public.tournament_teams (id) on delete cascade,
  display_order integer not null check (display_order >= 0),
  created_at timestamptz not null default now(),
  primary key (pool_id, team_id),
  unique (team_id),
  unique (pool_id, display_order)
);

create index tournament_pools_tournament_series_idx
on public.tournament_pools (tournament_id, series_id, display_order);

create index tournament_pool_teams_pool_idx
on public.tournament_pool_teams (pool_id, display_order);

alter table public.tournament_pools enable row level security;
alter table public.tournament_pool_teams enable row level security;

revoke all on table public.tournament_pools from public, anon, authenticated;
revoke all on table public.tournament_pool_teams from public, anon, authenticated;

