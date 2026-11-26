-- Ephemeral account audit fixture: historical identity table, indexes and player relation.
create table public.tournament_external_player_identities (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'errebot' check (btrim(source) <> ''),
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  phone text not null default '',
  first_name_normalized text not null,
  last_name_normalized text not null,
  phone_normalized text not null default '',
  profile_id uuid references public.profiles (id) on delete set null,
  member_id uuid references public.club_members (id) on delete set null,
  status text not null default 'unmatched'
    check (status in ('unmatched', 'suggested', 'verified', 'conflict')),
  verification_method text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    status <> 'verified'
    or (profile_id is not null and verified_at is not null)
  )
);

create unique index tournament_external_identity_exact_phone_unique
on public.tournament_external_player_identities (
  source,
  last_name_normalized,
  first_name_normalized,
  phone_normalized
)
where phone_normalized <> '';

create index tournament_external_identity_profile_idx
on public.tournament_external_player_identities (profile_id)
where profile_id is not null;

create index tournament_external_identity_member_idx
on public.tournament_external_player_identities (member_id)
where member_id is not null;

alter table public.tournament_external_player_identities add column verified_by uuid references public.profiles(id);
alter table public.tournament_team_players add column external_identity_id uuid references public.tournament_external_player_identities(id) on delete set null;
alter table public.tournament_external_player_identities enable row level security;
revoke all on public.tournament_external_player_identities from public, anon, authenticated;

-- Minimal auth/catalog dependencies for this isolated fixture; never install in production.
alter table auth.users add column if not exists email_confirmed_at timestamptz;
create or replace function public.normalize_member_identity(text)
returns text language sql immutable as $$ select lower(btrim(coalesce($1,''))) $$;
create or replace function public.profile_club_member_id(uuid,uuid)
returns uuid language sql stable as $$
 select m.id from public.club_members m join public.profiles p on p.id=$1
 where m.club_id=$2 and m.is_active and (m.sport_player_id=p.sport_player_id or m.id=p.member_id)
 limit 1
$$;
revoke all on function public.profile_club_member_id(uuid,uuid) from public, anon, authenticated;
