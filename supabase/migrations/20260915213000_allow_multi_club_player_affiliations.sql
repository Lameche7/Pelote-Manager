begin;

-- PILOTOKI conserve une identité sportive globale unique dans sport_players,
-- mais une même licence peut apparaître dans plusieurs registres de clubs
-- (club principal + une ou plusieurs extensions).
--
-- Cette migration ne modifie aucun parcours PCL : elle retire uniquement le
-- verrou d'unicité global devenu trop strict sur le registre local club_members.

do $$
begin
  if exists (
    select 1
    from public.club_members
    group by club_id, licence_number_normalized
    having count(*) > 1
  ) then
    raise exception 'Duplicate licence already exists inside the same club';
  end if;

  if exists (
    select 1
    from public.club_members
    where sport_player_id is not null
    group by club_id, sport_player_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate sport player already exists inside the same club';
  end if;
end;
$$;

-- Ancienne règle : une licence ne pouvait exister qu'une seule fois dans
-- l'ensemble de club_members. Cette responsabilité appartient désormais à
-- sport_players.licence_number.
drop index if exists public.club_members_licence_normalized_unique;

-- Nouvelle règle locale : un club ne peut toujours avoir qu'une seule fiche
-- pour une licence donnée, mais la même licence peut exister dans un autre club.
create unique index club_members_club_licence_normalized_unique
  on public.club_members (club_id, licence_number_normalized);

-- Protection complémentaire : deux fiches du même club ne doivent jamais
-- pointer vers la même identité sportive globale.
create unique index club_members_club_sport_player_unique
  on public.club_members (club_id, sport_player_id)
  where sport_player_id is not null;

comment on column public.club_members.sport_player_id is
  'Lien vers l’identité sportive globale PILOTOKI. Plusieurs clubs peuvent avoir une fiche locale distincte pointant vers le même joueur, mais une seule fiche par joueur et par club est autorisée.';

comment on table public.sport_player_club_affiliations is
  'Affiliations sportives globales joueur-club. Une même identité sportive peut être active dans plusieurs clubs (principal, extension ou statut encore inconnu).';

-- Invariant : toutes les fiches locales actuellement connues doivent continuer
-- à pointer vers une identité globale unique après le changement d'index.
do $$
begin
  if exists (
    select 1
    from public.club_members member
    where member.sport_player_id is null
      and regexp_replace(
        coalesce(member.licence_number_normalized, member.licence_number, ''),
        '[^0-9]+',
        '',
        'g'
      ) <> ''
  ) then
    raise exception 'A club member with a canonical licence is missing its global player';
  end if;
end;
$$;

commit;
