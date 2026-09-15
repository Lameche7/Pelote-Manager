begin;

-- Synchronise une fiche licencié locale vers l'identité sportive globale.
-- La fonction est appelée uniquement par trigger et n'est pas exposée comme API.
create function public.sync_club_member_sport_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_licence text;
  target_player_id uuid;
begin
  canonical_licence := regexp_replace(
    coalesce(new.licence_number_normalized, new.licence_number, ''),
    '[^0-9]+',
    '',
    'g'
  );

  -- Compatibilité de transition : une ancienne valeur non numérique ne bloque
  -- pas le parcours existant, mais elle ne crée pas d'identité réseau.
  if canonical_licence = '' then
    return new;
  end if;

  insert into public.sport_players (
    licence_number,
    first_name,
    last_name,
    birth_date,
    gender
  ) values (
    canonical_licence,
    new.first_name,
    new.last_name,
    new.birth_date,
    new.gender
  )
  on conflict (licence_number) do update
  set first_name = excluded.first_name,
      last_name = excluded.last_name,
      birth_date = coalesce(excluded.birth_date, public.sport_players.birth_date),
      gender = coalesce(excluded.gender, public.sport_players.gender),
      updated_at = now()
  returning id into target_player_id;

  if new.sport_player_id is distinct from target_player_id then
    update public.club_members
    set sport_player_id = target_player_id
    where id = new.id;
  end if;

  insert into public.sport_player_club_affiliations (
    sport_player_id,
    club_id,
    affiliation_type,
    is_active,
    source,
    source_member_id
  ) values (
    target_player_id,
    new.club_id,
    'unknown',
    new.is_active,
    'club_registry',
    new.id
  )
  on conflict (source_member_id) do update
  set sport_player_id = excluded.sport_player_id,
      club_id = excluded.club_id,
      is_active = excluded.is_active,
      source = excluded.source,
      updated_at = now();

  -- Maintient le pont de compatibilité profil -> membre -> joueur global.
  perform set_config('app.allow_profile_sport_player_link', 'on', true);

  update public.profiles
  set sport_player_id = target_player_id,
      updated_at = now()
  where member_id = new.id
    and sport_player_id is distinct from target_player_id;

  -- Un joueur de championnat déjà importé mais non encore rapproché bénéficie
  -- immédiatement de la nouvelle identité globale.
  update public.championship_players
  set sport_player_id = target_player_id,
      updated_at = now()
  where regexp_replace(coalesce(licence_number, ''), '[^0-9]+', '', 'g') = canonical_licence
    and sport_player_id is distinct from target_player_id;

  return new;
end;
$$;

revoke all on function public.sync_club_member_sport_player() from public;

create trigger sync_club_member_sport_player
after insert or update of
  licence_number,
  licence_number_normalized,
  first_name,
  last_name,
  birth_date,
  gender,
  club_id,
  is_active
on public.club_members
for each row execute function public.sync_club_member_sport_player();

-- Les imports Championnat alimentent eux aussi l'identité sportive globale.
-- Ils ne créent aucune affiliation club : une présence dans un championnat ne
-- suffit pas à déduire un club principal ou une extension.
create function public.sync_championship_player_sport_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_licence text;
  target_player_id uuid;
begin
  canonical_licence := regexp_replace(
    coalesce(new.licence_number, ''),
    '[^0-9]+',
    '',
    'g'
  );

  if canonical_licence = '' then
    return new;
  end if;

  insert into public.sport_players (
    licence_number,
    first_name,
    last_name
  ) values (
    canonical_licence,
    new.first_name,
    new.last_name
  )
  on conflict (licence_number) do update
  set updated_at = now()
  returning id into target_player_id;

  if new.sport_player_id is distinct from target_player_id then
    update public.championship_players
    set sport_player_id = target_player_id,
        updated_at = now()
    where id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_championship_player_sport_player() from public;

create trigger sync_championship_player_sport_player
after insert or update of licence_number, first_name, last_name
on public.championship_players
for each row execute function public.sync_championship_player_sport_player();

-- Backfill des joueurs de championnat qui n'étaient pas encore connus du PCL.
insert into public.sport_players (
  licence_number,
  first_name,
  last_name
)
select
  regexp_replace(coalesce(player.licence_number, ''), '[^0-9]+', '', 'g'),
  player.first_name,
  player.last_name
from public.championship_players as player
where regexp_replace(coalesce(player.licence_number, ''), '[^0-9]+', '', 'g') <> ''
on conflict (licence_number) do nothing;

update public.championship_players as championship_player
set sport_player_id = sport_player.id,
    updated_at = now()
from public.sport_players as sport_player
where sport_player.licence_number = regexp_replace(
    coalesce(championship_player.licence_number, ''),
    '[^0-9]+',
    '',
    'g'
  )
  and championship_player.sport_player_id is distinct from sport_player.id;

-- Invariants de sortie.
do $$
begin
  if exists (
    select 1
    from public.club_members as member
    where regexp_replace(
        coalesce(member.licence_number_normalized, member.licence_number, ''),
        '[^0-9]+',
        '',
        'g'
      ) <> ''
      and member.sport_player_id is null
  ) then
    raise exception 'A club member with a canonical licence is missing its global player';
  end if;

  if exists (
    select 1
    from public.championship_players as player
    where regexp_replace(coalesce(player.licence_number, ''), '[^0-9]+', '', 'g') <> ''
      and player.sport_player_id is null
  ) then
    raise exception 'A championship player with a canonical licence is missing its global player';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    join public.club_members as member on member.id = profile.member_id
    where member.sport_player_id is not null
      and profile.sport_player_id is distinct from member.sport_player_id
  ) then
    raise exception 'A linked profile is not synchronized with its member global player';
  end if;
end;
$$;

commit;
