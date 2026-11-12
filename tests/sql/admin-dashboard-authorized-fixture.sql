-- Tables métier fictives minimales pour exercer les trois RPC en PostgreSQL éphémère.
-- Aucun contenu de production n'est copié.
insert into public.club_role_permissions(role_id, permission_key)
select role_id, permission_key
from (
  values
    ('10000000-0000-0000-0000-000000000001'::uuid),
    ('10000000-0000-0000-0000-000000000002'::uuid)
) roles(role_id)
cross join (
  values ('admin.dashboard.read'), ('tournaments.manage'), ('championships.manage')
) permissions(permission_key);

create table public.reservable_resources (
  id uuid primary key, club_id uuid not null, name text not null
);
create table public.reservations (
  id uuid primary key, resource_id uuid not null,
  championship_match_id uuid, starts_at timestamptz, ends_at timestamptz,
  status text, created_at timestamptz
);
create table public.payments (
  id uuid primary key, reservation_id uuid, status text, expires_at timestamptz
);
create table public.calendar_occupations (
  id uuid primary key, resource_id uuid, title text, occupation_type text,
  starts_at timestamptz, ends_at timestamptz, cancelled_at timestamptz
);
create table public.event_types (
  id uuid primary key, name text, color text
);
create table public.events (
  id uuid primary key, club_id uuid, name text, event_type_id uuid,
  color text, starts_at timestamptz, ends_at timestamptz,
  visibility text, publication_status text, updated_at timestamptz
);
create table public.club_communications (
  id uuid primary key, club_id uuid, title text, priority text,
  published_at timestamptz, expires_at timestamptz,
  updated_at timestamptz, status text
);
create table public.communication_deliveries (
  id uuid primary key, communication_id uuid, club_id uuid, read_at timestamptz
);
create table public.tournaments (
  id uuid primary key, club_id uuid
);
create table public.tournament_matches (
  id uuid primary key, tournament_id uuid
);
create table public.tournament_match_results (
  id uuid primary key, match_id uuid, status text
);
create table public.tournament_match_planning (
  id uuid primary key, match_id uuid, play_date date
);
create table public.championships (
  id uuid primary key, status text
);
create table public.championship_divisions (
  id uuid primary key, championship_id uuid
);
create table public.championship_teams (
  id uuid primary key, federation_club_id uuid
);
create table public.championship_matches (
  id uuid primary key, division_id uuid, team1_id uuid, team2_id uuid,
  status text, score_team1 integer, score_team2 integer
);
create table public.championship_club_links (
  club_id uuid, championship_id uuid, federation_club_id uuid
);
create function public.club_member_profile_id(member_id uuid)
returns uuid language sql stable as $$ select null::uuid $$;

insert into public.reservable_resources values
('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Terrain A'),
('50000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Terrain B');
insert into public.reservations values
('51000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',null,now() + interval '1 hour',now() + interval '2 hours','confirmed',now()),
('51000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',null,now() + interval '1 hour',now() + interval '2 hours','confirmed',now()),
('51000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002',null,now() + interval '3 hours',now() + interval '4 hours','confirmed',now());
insert into public.tournaments values
('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
('60000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
insert into public.tournament_matches values
('61000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001'),
('61000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002'),
('61000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000002');
insert into public.tournament_match_results values
('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','validated'),
('62000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000002','validated'),
('62000000-0000-0000-0000-000000000003','61000000-0000-0000-0000-000000000003','validated');
insert into public.tournament_match_planning values
('63000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001',current_date),
('63000000-0000-0000-0000-000000000002','61000000-0000-0000-0000-000000000002',current_date),
('63000000-0000-0000-0000-000000000003','61000000-0000-0000-0000-000000000003',current_date);
