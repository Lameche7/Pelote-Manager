-- Draft: review and test before production installation.
-- Module configuration is not a grant of user permissions.
create schema if not exists pilotoki_private;

create table if not exists pilotoki_private.club_module_profiles (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  modules jsonb not null,
  updated_at timestamptz not null default now(),
  constraint club_module_profile_shape check (
    jsonb_typeof(modules) = 'object'
    and modules ?& array[
      'tournaments', 'tournamentPlanning', 'registrations',
      'tournamentRefereeing', 'payments', 'communication',
      'reservations', 'championships', 'licences', 'tv', 'live'
    ]
    and (modules - array[
      'tournaments', 'tournamentPlanning', 'registrations',
      'tournamentRefereeing', 'payments', 'communication',
      'reservations', 'championships', 'licences', 'tv', 'live'
    ]) = '{}'::jsonb
    and not jsonb_path_exists(modules, '$.* ? (@.type() != "boolean")')
  )
);

alter table pilotoki_private.club_module_profiles enable row level security;
revoke all on pilotoki_private.club_module_profiles from public, anon, authenticated;
grant select, insert, update, delete on pilotoki_private.club_module_profiles to service_role;
-- No client policy. A separately authorized server endpoint will manage profiles.
-- No seed data: do not change any existing club's behavior during installation.
