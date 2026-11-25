-- CI only: dependencies not present in the early core migration.
alter table public.tournaments
 add column minimum_availability_slots integer not null default 65,
 add column minimum_weekend_availability_slots integer not null default 0,
 add column minimum_finals_availability_slots integer not null default 35,
 add column slot_duration_minutes integer not null default 60,
 add column registration_fee_cents integer not null default 0,
 add column pool_starts_on date,
 add column pool_ends_on date,
 add column finals_starts_on date,
 add column finals_ends_on date,
 add column refereeing_enabled boolean not null default false;
create table public.tournament_teams (
 id uuid primary key default gen_random_uuid(),
 tournament_id uuid not null references public.tournaments(id),
 series_id uuid references public.tournament_series(id),
 status text not null
);
create table public.tournament_team_availability_slots (
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null references public.tournament_teams(id),
 tournament_id uuid not null references public.tournaments(id),
 play_date date not null, starts_at time not null, ends_at time not null
);
create table public.network_tournament_profiles (
 tournament_id uuid primary key references public.tournaments(id),
 specialty text, updated_at timestamptz not null default now()
);
-- Stubs for unrelated availability engine. Denial tests never reach these.
create function public.tournament_generated_slots(uuid)
returns table(play_date date, starts_at time, ends_at time, phase text)
language sql stable as $$ select null::date, null::time, null::time, null::text where false $$;
create function public.assert_tournament_team_finals_availability(uuid)
returns void language plpgsql as $$ begin
 raise exception 'Availability engine not installed in denial-only fixture';
end $$;
