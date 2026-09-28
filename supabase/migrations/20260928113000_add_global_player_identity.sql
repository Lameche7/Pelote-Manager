-- PILOTOKI Network - global player identity
-- Additive migration: existing club_members and profiles.member_id remain authoritative
-- for current PCL flows until the compatibility layer is migrated explicitly.

create table public.sport_players (
  id uuid primary key default gen_random_uuid(),
  licence_number text not null,
  first_name text not null,
  last_name text not null,
  birth_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sport_players_licence_number_not_blank check (btrim(licence_number) <> ''),
  constraint sport_players_first_name_not_blank check (btrim(first_name) <> ''),
  constraint sport_players_last_name_not_blank check (btrim(last_name) <> ''),
  constraint sport_players_licence_number_canonical
    check (licence_number = regexp_replace(upper(btrim(licence_number)), '[[:space:]]+', '', 'g')),
  unique (licence_number)
);

comment on table public.sport_players is
  'Global PILOTOKI sports identity. One row per canonical licence number, independent from club affiliation and application permissions.';

alter table public.sport_players enable row level security;
revoke all on table public.sport_players from public, anon, authenticated;

-- Seed the PCL licence registry first because it contains the richest local identity
-- (including birth date). Canonicalisation preserves leading zeroes.
insert into public.sport_players (licence_number, first_name, last_name, birth_date)
select
  regexp_replace(upper(btrim(members.licence_number)), '[[:space:]]+', '', 'g'),
  btrim(members.first_name),
  btrim(members.last_name),
  members.birth_date
from public.club_members as members
order by members.created_at, members.id
on conflict (licence_number) do nothing;

-- Championship imports may already know players who are not members of the PCL.
-- They also become network identities, without creating any club affiliation.
insert into public.sport_players (licence_number, first_name, last_name)
select distinct on (canonical_licence)
  canonical_licence,
  btrim(players.first_name),
  btrim(players.last_name)
from (
  select
    championship_players.*,
    regexp_replace(upper(btrim(championship_players.licence_number)), '[[:space:]]+', '', 'g') as canonical_licence
  from public.championship_players
) as players
order by canonical_licence, players.created_at, players.id
on conflict (licence_number) do nothing;

alter table public.club_members
  add column sport_player_id uuid references public.sport_players (id) on delete restrict;

update public.club_members as members
set sport_player_id = players.id
from public.sport_players as players
where players.licence_number =
  regexp_replace(upper(btrim(members.licence_number)), '[[:space:]]+', '', 'g');

do $$
begin
  if exists (
    select 1 from public.club_members where sport_player_id is null
  ) then
    raise exception 'Global player backfill incomplete for club_members';
  end if;
end;
$$;

create unique index club_members_sport_player_unique
  on public.club_members (sport_player_id);

alter table public.club_members
  alter column sport_player_id set not null;

comment on column public.club_members.sport_player_id is
  'Compatibility link to the global sports identity. club_members remains in place during the network migration.';

alter table public.championship_players
  add column sport_player_id uuid references public.sport_players (id) on delete restrict;

update public.championship_players as championship
set sport_player_id = players.id
from public.sport_players as players
where players.licence_number =
  regexp_replace(upper(btrim(championship.licence_number)), '[[:space:]]+', '', 'g');

do $$
begin
  if exists (
    select 1 from public.championship_players where sport_player_id is null
  ) then
    raise exception 'Global player backfill incomplete for championship_players';
  end if;
end;
$$;

alter table public.championship_players
  alter column sport_player_id set not null;

create index championship_players_sport_player_idx
  on public.championship_players (sport_player_id);

comment on column public.championship_players.sport_player_id is
  'Links source-specific championship identity to the global PILOTOKI sports identity.';

-- Keep existing insert/update flows compatible. The trigger creates a global identity
-- before a new club member is written and keeps the compatibility link populated.
create or replace function public.sync_club_member_sport_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_licence text;
  target_player_id uuid;
begin
  canonical_licence :=
    regexp_replace(upper(btrim(new.licence_number)), '[[:space:]]+', '', 'g');

  if canonical_licence = '' then
    raise exception 'Licence number is required' using errcode = '22023';
  end if;

  insert into public.sport_players (
    licence_number, first_name, last_name, birth_date
  )
  values (
    canonical_licence, btrim(new.first_name), btrim(new.last_name), new.birth_date
  )
  on conflict (licence_number) do update
  set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    birth_date = coalesce(excluded.birth_date, public.sport_players.birth_date),
    updated_at = now()
  returning id into target_player_id;

  new.sport_player_id := target_player_id;
  return new;
end;
$$;

revoke all on function public.sync_club_member_sport_player() from public;

create trigger sync_club_member_sport_player
before insert or update of licence_number, first_name, last_name, birth_date
on public.club_members
for each row execute function public.sync_club_member_sport_player();

-- Championship imports use the same licence identity but remain source-specific.
create or replace function public.sync_championship_player_sport_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_licence text;
  target_player_id uuid;
begin
  canonical_licence :=
    regexp_replace(upper(btrim(new.licence_number)), '[[:space:]]+', '', 'g');

  if canonical_licence = '' then
    raise exception 'Licence number is required' using errcode = '22023';
  end if;

  insert into public.sport_players (licence_number, first_name, last_name)
  values (canonical_licence, btrim(new.first_name), btrim(new.last_name))
  on conflict (licence_number) do update
  set
    first_name = case
      when public.sport_players.first_name = '' then excluded.first_name
      else public.sport_players.first_name
    end,
    last_name = case
      when public.sport_players.last_name = '' then excluded.last_name
      else public.sport_players.last_name
    end,
    updated_at = now()
  returning id into target_player_id;

  new.sport_player_id := target_player_id;
  return new;
end;
$$;

revoke all on function public.sync_championship_player_sport_player() from public;

create trigger sync_championship_player_sport_player
before insert or update of licence_number, first_name, last_name
on public.championship_players
for each row execute function public.sync_championship_player_sport_player();

-- Verification helper intentionally exposes counts only and no player data.
create or replace function public.verify_global_player_identity_backfill()
returns table (
  sport_player_count bigint,
  club_member_count bigint,
  unlinked_club_member_count bigint,
  championship_player_count bigint,
  unlinked_championship_player_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.sport_players),
    (select count(*) from public.club_members),
    (select count(*) from public.club_members where sport_player_id is null),
    (select count(*) from public.championship_players),
    (select count(*) from public.championship_players where sport_player_id is null);
$$;

revoke all on function public.verify_global_player_identity_backfill() from public;
grant execute on function public.verify_global_player_identity_backfill() to authenticated;
