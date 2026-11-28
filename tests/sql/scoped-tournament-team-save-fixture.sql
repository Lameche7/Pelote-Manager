-- Only for the empty ephemeral CI database after tournament denial tests.
-- Replace the minimal team table with the historical registration schema.
begin;
alter table public.tournament_team_availability_slots drop constraint tournament_team_availability_slots_team_id_fkey;
drop table public.tournament_teams;
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'tournament_team_status'
  ) then
    create type public.tournament_team_status as enum (
      'pending',
      'accepted',
      'rejected',
      'withdrawn'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'tournament_player_role'
  ) then
    create type public.tournament_player_role as enum ('front', 'back');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'tournament_availability_kind'
  ) then
    create type public.tournament_availability_kind as enum (
      'unavailable',
      'preferred',
      'possible'
    );
  end if;
end
$$;

create table if not exists public.tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  series_id uuid not null references public.tournament_series (id) on delete restrict,
  status public.tournament_team_status not null default 'pending',
  contact_email text not null check (btrim(contact_email) <> ''),
  contact_phone text not null default '',
  comments text not null default '',
  submitted_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  validated_by uuid references public.profiles (id) on delete set null,
  registered_at timestamptz not null default now(),
  validated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, tournament_id)
);

create table if not exists public.tournament_team_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  tournament_id uuid not null,
  member_id uuid references public.club_members (id) on delete set null,
  role public.tournament_player_role not null,
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  email text not null default '',
  phone text not null default '',
  display_order smallint not null check (display_order between 0 and 7),
  foreign key (team_id, tournament_id)
    references public.tournament_teams (id, tournament_id)
    on delete cascade,
  unique (team_id, role),
  unique (team_id, display_order)
);

create table if not exists public.tournament_team_availability_rules (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  tournament_id uuid not null,
  kind public.tournament_availability_kind not null,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (team_id, tournament_id)
    references public.tournament_teams (id, tournament_id)
    on delete cascade,
  unique (team_id, kind, weekday, starts_at, ends_at)
);

create index if not exists tournament_teams_tournament_status_idx
on public.tournament_teams (tournament_id, status, series_id, registered_at);

create index if not exists tournament_team_players_tournament_idx
on public.tournament_team_players (tournament_id, team_id, display_order);

create index if not exists tournament_team_players_member_idx
on public.tournament_team_players (tournament_id, member_id)
where member_id is not null;

create index if not exists tournament_team_availability_idx
on public.tournament_team_availability_rules (
  tournament_id,
  team_id,
  weekday,
  starts_at
);

create unique index if not exists tournament_team_submitter_active_unique
on public.tournament_teams (tournament_id, submitted_by)
where submitted_by is not null and status in ('pending', 'accepted');

alter table public.tournament_teams enable row level security;
alter table public.tournament_team_players enable row level security;
alter table public.tournament_team_availability_rules enable row level security;

revoke all on table public.tournament_teams from public, anon, authenticated;
revoke all on table public.tournament_team_players from public, anon, authenticated;
revoke all on table public.tournament_team_availability_rules from public, anon, authenticated;

create or replace function public.tournament_series_reserved_count(
  target_series_id uuid,
  excluded_team_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.tournament_teams as team
  where team.series_id = target_series_id
    and team.status in ('pending', 'accepted')
    and (excluded_team_id is null or team.id <> excluded_team_id);
$$;

create or replace function public.tournament_series_has_capacity(
  target_series_id uuid,
  excluded_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select series.enabled
      and public.tournament_series_reserved_count(series.id, excluded_team_id) < series.capacity
    from public.tournament_series as series
    where series.id = target_series_id
  ), false);
$$;

create or replace function public.tournament_registration_is_open(
  target_tournament_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select tournament.status = 'registrations_open'
      and tournament.registration_opens_at <= now()
      and tournament.registration_closes_at > now()
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
  ), false);
$$;

create or replace function public.save_tournament_team_children(
  target_team_id uuid,
  target_tournament_id uuid,
  target_club_id uuid,
  players jsonb,
  availability_rules jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  item_index integer := 0;
  item_member_id uuid;
  item_role text;
  item_first_name text;
  item_last_name text;
  item_kind text;
  item_weekday integer;
  item_starts_at time;
  item_ends_at time;
begin
  if jsonb_typeof(coalesce(players, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(players, '[]'::jsonb)) <> 2 then
    raise exception 'A tournament team must contain exactly two players'
      using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(availability_rules, '[]'::jsonb)) <> 'array' then
    raise exception 'Tournament availability rules are invalid'
      using errcode = '22023';
  end if;

  -- Valider tous les joueurs avant de remplacer les lignes existantes.
  item_index := 0;
  for item in select value from jsonb_array_elements(players)
  loop
    item_role := coalesce(item->>'role', '');
    item_first_name := btrim(coalesce(item->>'first_name', ''));
    item_last_name := btrim(coalesce(item->>'last_name', ''));
    item_member_id := nullif(item->>'member_id', '')::uuid;

    if item_role not in ('front', 'back')
      or item_first_name = ''
      or item_last_name = '' then
      raise exception 'Tournament players are invalid' using errcode = '22023';
    end if;

    if item_member_id is not null then
      if not exists (
        select 1
        from public.club_members as member
        where member.id = item_member_id
          and member.club_id = target_club_id
          and member.is_active
      ) then
        raise exception 'Tournament member is invalid' using errcode = '22023';
      end if;

      if exists (
        select 1
        from public.tournament_team_players as existing_player
        join public.tournament_teams as existing_team
          on existing_team.id = existing_player.team_id
        where existing_player.tournament_id = target_tournament_id
          and existing_player.member_id = item_member_id
          and existing_player.team_id <> target_team_id
          and existing_team.status in ('pending', 'accepted')
      ) then
        raise exception 'A player can only belong to one active team per tournament'
          using errcode = '23505';
      end if;
    end if;

    item_index := item_index + 1;
  end loop;

  if (
    select count(distinct value->>'role')
    from jsonb_array_elements(players)
  ) <> 2 then
    raise exception 'A team must contain one front player and one back player'
      using errcode = '22023';
  end if;

  -- Valider les disponibilités avant remplacement.
  for item in select value from jsonb_array_elements(coalesce(availability_rules, '[]'::jsonb))
  loop
    item_kind := coalesce(item->>'kind', '');
    item_weekday := nullif(item->>'weekday', '')::integer;
    item_starts_at := nullif(item->>'starts_at', '')::time;
    item_ends_at := nullif(item->>'ends_at', '')::time;

    if item_kind not in ('unavailable', 'preferred', 'possible')
      or item_weekday is null
      or item_weekday < 0
      or item_weekday > 6
      or item_starts_at is null
      or item_ends_at is null
      or item_ends_at <= item_starts_at then
      raise exception 'Tournament availability rules are invalid'
        using errcode = '22023';
    end if;
  end loop;

  delete from public.tournament_team_players
  where team_id = target_team_id;

  item_index := 0;
  for item in select value from jsonb_array_elements(players)
  loop
    insert into public.tournament_team_players (
      team_id,
      tournament_id,
      member_id,
      role,
      first_name,
      last_name,
      email,
      phone,
      display_order
    )
    values (
      target_team_id,
      target_tournament_id,
      nullif(item->>'member_id', '')::uuid,
      (item->>'role')::public.tournament_player_role,
      btrim(item->>'first_name'),
      btrim(item->>'last_name'),
      btrim(coalesce(item->>'email', '')),
      btrim(coalesce(item->>'phone', '')),
      item_index
    );
    item_index := item_index + 1;
  end loop;

  delete from public.tournament_team_availability_rules
  where team_id = target_team_id;

  item_index := 0;
  for item in select value from jsonb_array_elements(coalesce(availability_rules, '[]'::jsonb))
  loop
    insert into public.tournament_team_availability_rules (
      team_id,
      tournament_id,
      kind,
      weekday,
      starts_at,
      ends_at,
      display_order
    )
    values (
      target_team_id,
      target_tournament_id,
      (item->>'kind')::public.tournament_availability_kind,
      (item->>'weekday')::smallint,
      (item->>'starts_at')::time,
      (item->>'ends_at')::time,
      item_index
    );
    item_index := item_index + 1;
  end loop;
end;
$$;

revoke all on function public.tournament_series_reserved_count(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tournament_series_has_capacity(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tournament_registration_is_open(uuid) from public, anon, authenticated;
revoke all on function public.save_tournament_team_children(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;


alter table public.tournament_team_availability_slots add foreign key (team_id) references public.tournament_teams(id) on delete cascade;
alter table public.tournament_team_players add column club_name text not null default '';
alter table public.club_members add column first_name text, add column last_name text, add column email text, add column phone text;
commit;
