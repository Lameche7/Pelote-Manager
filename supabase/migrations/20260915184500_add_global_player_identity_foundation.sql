begin;

create table public.sport_players (
  id uuid primary key default gen_random_uuid(),
  licence_number text not null,
  first_name text not null,
  last_name text not null,
  birth_date date,
  gender text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sport_players_licence_number_not_blank
    check (btrim(licence_number) <> ''),
  constraint sport_players_first_name_not_blank
    check (btrim(first_name) <> ''),
  constraint sport_players_last_name_not_blank
    check (btrim(last_name) <> ''),
  constraint sport_players_licence_number_unique unique (licence_number)
);

comment on table public.sport_players is
  'Identité sportive globale PILOTOKI. Une licence fédérale correspond à une seule identité, indépendamment des clubs auxquels le joueur est affilié.';
comment on column public.sport_players.licence_number is
  'Numéro de licence fédérale canonique et unique à l’échelle de PILOTOKI.';

create table public.sport_player_club_affiliations (
  id uuid primary key default gen_random_uuid(),
  sport_player_id uuid not null references public.sport_players(id) on delete restrict,
  club_id uuid not null references public.clubs(id) on delete cascade,
  affiliation_type text not null default 'unknown',
  is_active boolean not null default true,
  starts_on date,
  ends_on date,
  source text not null default 'club_registry',
  source_member_id uuid unique references public.club_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sport_player_club_affiliation_type_check
    check (affiliation_type in ('primary', 'extension', 'unknown')),
  constraint sport_player_club_affiliation_dates_check
    check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

comment on table public.sport_player_club_affiliations is
  'Affiliations sportives d’une identité globale à un ou plusieurs clubs. Le type unknown permet de migrer sans inventer principal/extension pour les données historiques.';

create index sport_player_club_affiliations_player_idx
  on public.sport_player_club_affiliations (sport_player_id);
create index sport_player_club_affiliations_club_idx
  on public.sport_player_club_affiliations (club_id);
create unique index sport_player_club_affiliations_current_unique
  on public.sport_player_club_affiliations (sport_player_id, club_id)
  where is_active and ends_on is null;

alter table public.club_members
  add column sport_player_id uuid references public.sport_players(id) on delete restrict;

alter table public.profiles
  add column sport_player_id uuid references public.sport_players(id) on delete restrict;

alter table public.championship_players
  add column sport_player_id uuid references public.sport_players(id) on delete restrict;

create unique index profiles_sport_player_id_unique
  on public.profiles (sport_player_id)
  where sport_player_id is not null;

-- Le registre PCL actuel devient la première source de vérité pour amorcer
-- l’identité sportive globale. Les coordonnées privées restent dans club_members.
insert into public.sport_players (
  licence_number,
  first_name,
  last_name,
  birth_date,
  gender
)
select
  member.licence_number_normalized,
  member.first_name,
  member.last_name,
  member.birth_date,
  member.gender
from public.club_members as member
where member.licence_number_normalized is not null
  and btrim(member.licence_number_normalized) <> ''
on conflict (licence_number) do nothing;

update public.club_members as member
set sport_player_id = player.id
from public.sport_players as player
where player.licence_number = member.licence_number_normalized
  and member.sport_player_id is null;

-- On ne déduit pas arbitrairement principal/extension des anciennes fiches.
insert into public.sport_player_club_affiliations (
  sport_player_id,
  club_id,
  affiliation_type,
  is_active,
  source,
  source_member_id
)
select
  member.sport_player_id,
  member.club_id,
  'unknown',
  member.is_active,
  'club_registry',
  member.id
from public.club_members as member
where member.sport_player_id is not null
on conflict (source_member_id) do nothing;

-- Lien fantôme côté comptes : aucun écran ne l’utilise encore. member_id reste
-- la source de compatibilité des parcours PCL tant que la bascule n’est pas faite.
update public.profiles as profile
set sport_player_id = member.sport_player_id
from public.club_members as member
where profile.member_id = member.id
  and member.sport_player_id is not null
  and profile.sport_player_id is null;

-- Les joueurs de championnat déjà reconnus par licence peuvent pointer vers la
-- même identité globale sans modifier le fonctionnement du module Championnat.
update public.championship_players as championship_player
set sport_player_id = player.id
from public.sport_players as player
where championship_player.licence_number = player.licence_number
  and championship_player.sport_player_id is null;

-- Garde-fous de migration : chaque fiche licencié canonique existante doit être
-- reliée, et un profil lié à un membre ne doit jamais pointer vers un autre joueur.
do $$
begin
  if exists (
    select 1
    from public.club_members
    where licence_number_normalized is not null
      and btrim(licence_number_normalized) <> ''
      and sport_player_id is null
  ) then
    raise exception 'Global player backfill incomplete for club_members';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    join public.club_members as member on member.id = profile.member_id
    where member.sport_player_id is not null
      and profile.sport_player_id is distinct from member.sport_player_id
  ) then
    raise exception 'Profile global player link conflicts with legacy member link';
  end if;
end;
$$;

-- Ces tables contiennent des données personnelles globales. Elles ne deviennent
-- pas des endpoints directs de l’application dans cette PR.
alter table public.sport_players enable row level security;
alter table public.sport_player_club_affiliations enable row level security;

revoke all on table public.sport_players from anon, authenticated;
revoke all on table public.sport_player_club_affiliations from anon, authenticated;

commit;
