insert into public.permissions (key, description)
values ('championships.manage', 'Gérer les championnats')
on conflict (key) do nothing;

insert into public.club_role_permissions (role_id, permission_key)
select roles.id, 'championships.manage'
from public.club_roles as roles
where roles.key = 'administrator'::public.club_role_key
on conflict (role_id, permission_key) do nothing;

create type public.championship_status as enum (
  'preparation',
  'active',
  'completed',
  'archived'
);

create type public.championship_club_access_role as enum (
  'manager',
  'participant'
);

create type public.championship_import_status as enum (
  'preview',
  'applied',
  'failed'
);

create type public.championship_import_kind as enum (
  'matches',
  'engagements',
  'standings',
  'rules'
);

create type public.championship_match_status as enum (
  'to_schedule',
  'scheduled',
  'postponed',
  'played',
  'forfeit',
  'cancelled'
);

create type public.championship_player_link_status as enum (
  'unlinked',
  'claimed',
  'verified'
);

create table public.championships (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  specialty text not null default '' ,
  season_label text not null default '',
  source_provider text not null default 'ffpb' check (btrim(source_provider) <> ''),
  source_external_id text,
  source_url text,
  status public.championship_status not null default 'preparation',
  starts_on date,
  ends_on date,
  timezone text not null default 'Europe/Paris',
  created_by_club_id uuid references public.clubs (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create unique index championships_source_external_id_unique
on public.championships (source_provider, source_external_id)
where source_external_id is not null;

create table public.championship_federation_clubs (
  id uuid primary key default gen_random_uuid(),
  source_provider text not null default 'ffpb' check (btrim(source_provider) <> ''),
  source_external_id text,
  name text not null check (btrim(name) <> ''),
  normalized_name text not null check (btrim(normalized_name) <> ''),
  linked_club_id uuid references public.clubs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_provider, normalized_name)
);

create unique index championship_federation_clubs_external_id_unique
on public.championship_federation_clubs (source_provider, source_external_id)
where source_external_id is not null;

create unique index championship_federation_clubs_linked_club_unique
on public.championship_federation_clubs (source_provider, linked_club_id)
where linked_club_id is not null;

create table public.championship_players (
  id uuid primary key default gen_random_uuid(),
  source_provider text not null default 'ffpb' check (btrim(source_provider) <> ''),
  licence_number text not null check (btrim(licence_number) <> ''),
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  normalized_first_name text not null check (btrim(normalized_first_name) <> ''),
  normalized_last_name text not null check (btrim(normalized_last_name) <> ''),
  profile_id uuid references public.profiles (id) on delete set null,
  link_status public.championship_player_link_status not null default 'unlinked',
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_provider, licence_number),
  check (
    (profile_id is null and link_status = 'unlinked')
    or (profile_id is not null and link_status <> 'unlinked')
  )
);

create unique index championship_players_profile_unique
on public.championship_players (source_provider, profile_id)
where profile_id is not null;

create table public.championship_divisions (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  normalized_name text not null check (btrim(normalized_name) <> ''),
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (championship_id, normalized_name)
);

create table public.championship_pools (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.championship_divisions (id) on delete cascade,
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  unique (division_id, code),
  unique (id, division_id)
);

create table public.championship_teams (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.championship_divisions (id) on delete cascade,
  federation_club_id uuid not null references public.championship_federation_clubs (id) on delete restrict,
  pool_id uuid,
  team_number text not null check (btrim(team_number) <> ''),
  source_label text not null check (btrim(source_label) <> ''),
  source_rank integer check (source_rank is null or source_rank > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (division_id, federation_club_id, team_number),
  unique (id, division_id),
  foreign key (pool_id, division_id)
    references public.championship_pools (id, division_id)
    on delete set null
);

create table public.championship_team_players (
  team_id uuid not null references public.championship_teams (id) on delete cascade,
  player_id uuid not null references public.championship_players (id) on delete restrict,
  source_entry text not null default '',
  source_flags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  primary key (team_id, player_id)
);

create table public.championship_club_links (
  championship_id uuid not null references public.championships (id) on delete cascade,
  federation_club_id uuid not null references public.championship_federation_clubs (id) on delete restrict,
  club_id uuid not null references public.clubs (id) on delete cascade,
  access_role public.championship_club_access_role not null default 'participant',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (championship_id, club_id),
  unique (championship_id, federation_club_id)
);

create table public.championship_import_batches (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  status public.championship_import_status not null default 'preview',
  source_url text,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  check (
    (status = 'preview' and applied_at is null and failed_at is null)
    or (status = 'applied' and applied_at is not null and failed_at is null)
    or (status = 'failed' and failed_at is not null and applied_at is null)
  )
);

create table public.championship_import_files (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.championship_import_batches (id) on delete cascade,
  kind public.championship_import_kind not null,
  file_name text not null check (btrim(file_name) <> ''),
  checksum text not null check (btrim(checksum) <> ''),
  row_count integer not null default 0 check (row_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch_id, checksum)
);

create table public.championship_matches (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.championship_divisions (id) on delete cascade,
  pool_id uuid,
  phase text not null check (btrim(phase) <> ''),
  source_key text not null check (btrim(source_key) <> ''),
  team1_id uuid,
  team2_id uuid,
  scheduled_on date,
  scheduled_time time,
  report_on date,
  report_time time,
  venue text,
  agreement_on date,
  agreement_time time,
  agreement_venue text,
  status public.championship_match_status not null default 'to_schedule',
  score_team1 integer check (score_team1 is null or score_team1 >= 0),
  score_team2 integer check (score_team2 is null or score_team2 >= 0),
  score_raw text,
  result_comment text,
  source_metadata jsonb not null default '{}'::jsonb,
  source_import_file_id uuid references public.championship_import_files (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (division_id, source_key),
  foreign key (pool_id, division_id)
    references public.championship_pools (id, division_id)
    on delete set null,
  foreign key (team1_id, division_id)
    references public.championship_teams (id, division_id)
    on delete restrict,
  foreign key (team2_id, division_id)
    references public.championship_teams (id, division_id)
    on delete restrict,
  check (team1_id is null or team2_id is null or team1_id <> team2_id)
);

create table public.championship_standings (
  pool_id uuid not null references public.championship_pools (id) on delete cascade,
  team_id uuid not null references public.championship_teams (id) on delete cascade,
  rank integer check (rank is null or rank > 0),
  played integer check (played is null or played >= 0),
  wins integer check (wins is null or wins >= 0),
  draws integer check (draws is null or draws >= 0),
  losses integer check (losses is null or losses >= 0),
  points numeric,
  score_for integer,
  score_against integer,
  score_difference integer,
  source_payload jsonb not null default '{}'::jsonb,
  source_import_file_id uuid references public.championship_import_files (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (pool_id, team_id)
);

create table public.championship_audit_log (
  id bigint generated always as identity primary key,
  championship_id uuid not null references public.championships (id) on delete cascade,
  club_id uuid references public.clubs (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (btrim(action) <> ''),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index championship_divisions_championship_idx
on public.championship_divisions (championship_id, display_order, name);

create index championship_teams_division_pool_idx
on public.championship_teams (division_id, pool_id, source_label);

create index championship_team_players_player_idx
on public.championship_team_players (player_id, team_id);

create index championship_club_links_club_idx
on public.championship_club_links (club_id, access_role, championship_id);

create index championship_import_batches_championship_idx
on public.championship_import_batches (championship_id, created_at desc);

create index championship_matches_schedule_idx
on public.championship_matches (division_id, scheduled_on, status);

create index championship_matches_teams_idx
on public.championship_matches (team1_id, team2_id);

create index championship_audit_championship_idx
on public.championship_audit_log (championship_id, created_at desc);

alter table public.championships enable row level security;
alter table public.championship_federation_clubs enable row level security;
alter table public.championship_players enable row level security;
alter table public.championship_divisions enable row level security;
alter table public.championship_pools enable row level security;
alter table public.championship_teams enable row level security;
alter table public.championship_team_players enable row level security;
alter table public.championship_club_links enable row level security;
alter table public.championship_import_batches enable row level security;
alter table public.championship_import_files enable row level security;
alter table public.championship_matches enable row level security;
alter table public.championship_standings enable row level security;
alter table public.championship_audit_log enable row level security;

revoke all on table public.championships from public, anon, authenticated;
revoke all on table public.championship_federation_clubs from public, anon, authenticated;
revoke all on table public.championship_players from public, anon, authenticated;
revoke all on table public.championship_divisions from public, anon, authenticated;
revoke all on table public.championship_pools from public, anon, authenticated;
revoke all on table public.championship_teams from public, anon, authenticated;
revoke all on table public.championship_team_players from public, anon, authenticated;
revoke all on table public.championship_club_links from public, anon, authenticated;
revoke all on table public.championship_import_batches from public, anon, authenticated;
revoke all on table public.championship_import_files from public, anon, authenticated;
revoke all on table public.championship_matches from public, anon, authenticated;
revoke all on table public.championship_standings from public, anon, authenticated;
revoke all on table public.championship_audit_log from public, anon, authenticated;

create or replace function public.championship_club_can_manage(
  target_championship_id uuid,
  target_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.has_club_permission(target_club_id, 'championships.manage')
    and exists (
      select 1
      from public.championship_club_links as link
      where link.championship_id = target_championship_id
        and link.club_id = target_club_id
        and link.access_role = 'manager'
    );
$$;

create or replace function public.admin_list_championships()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if not public.has_club_permission(target_club_id, 'championships.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', championship.id,
          'name', championship.name,
          'specialty', championship.specialty,
          'season_label', championship.season_label,
          'status', championship.status,
          'source_provider', championship.source_provider,
          'source_external_id', championship.source_external_id,
          'source_url', championship.source_url,
          'starts_on', championship.starts_on,
          'ends_on', championship.ends_on,
          'access_role', link.access_role,
          'division_count', (
            select count(*)
            from public.championship_divisions as division
            where division.championship_id = championship.id
          ),
          'team_count', (
            select count(*)
            from public.championship_teams as team
            join public.championship_divisions as division on division.id = team.division_id
            where division.championship_id = championship.id
          ),
          'match_count', (
            select count(*)
            from public.championship_matches as match
            join public.championship_divisions as division on division.id = match.division_id
            where division.championship_id = championship.id
          ),
          'updated_at', championship.updated_at
        )
        order by championship.starts_on desc nulls last, championship.name
      ),
      '[]'::jsonb
    )
    from public.championship_club_links as link
    join public.championships as championship on championship.id = link.championship_id
    where link.club_id = target_club_id
  );
end;
$$;

create or replace function public.admin_get_championship_core(target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  result jsonb;
begin
  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', championship.id,
    'name', championship.name,
    'specialty', championship.specialty,
    'season_label', championship.season_label,
    'status', championship.status,
    'source_provider', championship.source_provider,
    'source_external_id', championship.source_external_id,
    'source_url', championship.source_url,
    'starts_on', championship.starts_on,
    'ends_on', championship.ends_on,
    'divisions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', division.id,
            'name', division.name,
            'display_order', division.display_order,
            'pool_count', (
              select count(*)
              from public.championship_pools as pool
              where pool.division_id = division.id
            ),
            'team_count', (
              select count(*)
              from public.championship_teams as team
              where team.division_id = division.id
            ),
            'match_count', (
              select count(*)
              from public.championship_matches as match
              where match.division_id = division.id
            )
          )
          order by division.display_order, division.name
        ),
        '[]'::jsonb
      )
      from public.championship_divisions as division
      where division.championship_id = championship.id
    ),
    'club_links', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'club_id', link.club_id,
            'federation_club_id', link.federation_club_id,
            'federation_club_name', federation_club.name,
            'access_role', link.access_role
          )
          order by federation_club.name
        ),
        '[]'::jsonb
      )
      from public.championship_club_links as link
      join public.championship_federation_clubs as federation_club
        on federation_club.id = link.federation_club_id
      where link.championship_id = championship.id
    ),
    'updated_at', championship.updated_at
  )
  into result
  from public.championships as championship
  where championship.id = target_id;

  if result is null then
    raise exception 'Championship not found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke all on function public.championship_club_can_manage(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_list_championships() from public, anon, authenticated;
revoke all on function public.admin_get_championship_core(uuid) from public, anon, authenticated;

grant execute on function public.admin_list_championships() to authenticated;
grant execute on function public.admin_get_championship_core(uuid) to authenticated;
