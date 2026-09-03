begin;

-- PR130 — rattachement volontaire d'une identité externe à un compte.
--
-- Le nom et le prénom servent à proposer des participations possibles lors de
-- la création du compte. Les coordonnées provenant du système source ne sont
-- ni utilisées comme preuve d'identité, ni renvoyées au navigateur.
--
-- La confirmation d'une participation ne valide aucune licence et ne crée
-- aucune appartenance à un club. Une licence pourra être rattachée plus tard au
-- même profil ; le lien sera alors propagé à l'identité externe.

-- ---------------------------------------------------------------------------
-- Nettoyage du prototype administrateur de la première version de PR130.
-- Ces objets peuvent exister sur le projet de test où la migration 16:00 a été
-- appliquée avant que le parcours produit soit recentré sur la création de compte.
-- ---------------------------------------------------------------------------

drop function if exists public.admin_list_errebot_identity_links(uuid);
drop function if exists public.admin_search_errebot_identity_link_candidates(text);
drop function if exists public.admin_link_errebot_identity_candidate(uuid, uuid, uuid, uuid);

drop trigger if exists sync_profile_to_verified_errebot_identities
on public.profiles;
drop function if exists public.sync_profile_to_verified_errebot_identities();

-- L'ancien trigger de propagation était limité à une source et à member_id.
-- Il est remplacé par une version générique qui sait aussi gérer profile_id.
drop trigger if exists sync_verified_errebot_identity_to_imported_players
on public.tournament_external_player_identities;
drop function if exists public.sync_verified_errebot_identity_to_imported_players();

-- ---------------------------------------------------------------------------
-- Recherche publique minimale : prénom + nom exacts après normalisation.
-- Seules des informations sportives déjà nécessaires à la confirmation sont
-- renvoyées : tournoi, série, partenaire et poste. Aucun email/téléphone/source.
-- ---------------------------------------------------------------------------

create or replace function public.find_external_participation_candidates(
  first_name text,
  last_name text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  input_first_name text := btrim(coalesce(first_name, ''));
  input_last_name text := btrim(coalesce(last_name, ''));
  normalized_first_name text;
  normalized_last_name text;
begin
  if length(input_first_name) < 2 or length(input_last_name) < 2 then
    return '[]'::jsonb;
  end if;

  normalized_first_name := public.normalize_member_identity(input_first_name);
  normalized_last_name := public.normalize_member_identity(input_last_name);

  if normalized_first_name = '' or normalized_last_name = '' then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'externalIdentityId', candidate.external_identity_id,
          'tournamentId', candidate.tournament_id,
          'teamId', candidate.team_id,
          'tournamentName', candidate.tournament_name,
          'seriesName', candidate.series_name,
          'partnerFirstName', candidate.partner_first_name,
          'partnerLastName', candidate.partner_last_name,
          'role', candidate.role
        )
        order by candidate.starts_on desc, candidate.tournament_name, candidate.team_id
      ),
      '[]'::jsonb
    )
    from (
      select distinct
        identity.id as external_identity_id,
        tournament.id as tournament_id,
        team.id as team_id,
        tournament.name as tournament_name,
        series.name as series_name,
        partner.first_name as partner_first_name,
        partner.last_name as partner_last_name,
        player.role,
        tournament.starts_on
      from public.tournament_external_player_identities as identity
      join public.tournament_team_players as player
        on player.external_identity_id = identity.id
      join public.tournament_teams as team
        on team.id = player.team_id
       and team.tournament_id = player.tournament_id
      join public.tournaments as tournament
        on tournament.id = player.tournament_id
      join public.tournament_series as series
        on series.id = team.series_id
       and series.tournament_id = tournament.id
      left join lateral (
        select other.first_name, other.last_name
        from public.tournament_team_players as other
        where other.team_id = player.team_id
          and other.id <> player.id
        order by other.display_order, other.id
        limit 1
      ) as partner on true
      where identity.status = 'unmatched'
        and identity.profile_id is null
        and identity.member_id is null
        and identity.first_name_normalized = normalized_first_name
        and identity.last_name_normalized = normalized_last_name
        and team.status in ('pending', 'accepted')
        and tournament.status <> 'cancelled'
        and exists (
          select 1
          from public.tournament_import_team_refs as import_ref
          join public.tournament_imports as import_row
            on import_row.id = import_ref.import_id
           and import_row.status = 'imported'
          where import_ref.team_id = team.id
            and import_row.tournament_id = tournament.id
        )
      order by tournament.starts_on desc, tournament.name, team.id
      limit 12
    ) as candidate
  );
end;
$$;

revoke all on function public.find_external_participation_candidates(text, text)
from public, anon, authenticated;
grant execute on function public.find_external_participation_candidates(text, text)
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Propagation d'une identité externe vérifiée vers les lignes joueur natives.
-- profile_id donne les droits du compte ; member_id n'est ajouté que lorsqu'une
-- vraie fiche licencié est reliée au profil.
-- ---------------------------------------------------------------------------

create or replace function public.sync_verified_external_identity_to_tournament_players()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile public.profiles%rowtype;
  target_member public.club_members%rowtype;
  target_club_name text;
begin
  if new.status <> 'verified'
    or (new.profile_id is null and new.member_id is null) then
    return new;
  end if;

  if new.profile_id is not null then
    select profile.*
    into target_profile
    from public.profiles as profile
    where profile.id = new.profile_id;

    if target_profile.id is null then
      return new;
    end if;
  end if;

  if new.member_id is not null then
    select member.*
    into target_member
    from public.club_members as member
    where member.id = new.member_id
      and member.is_active;

    if target_member.id is null then
      return new;
    end if;

    select club.name
    into target_club_name
    from public.clubs as club
    where club.id = target_member.club_id;
  end if;

  if target_profile.id is not null
    and target_member.id is not null
    and target_profile.member_id is not null
    and target_profile.member_id <> target_member.id then
    raise exception 'External identity profile/member link is inconsistent'
      using errcode = '23505';
  end if;

  -- Une identité externe ne peut pas représenter deux joueurs du même tournoi.
  if exists (
    select 1
    from public.tournament_team_players as affected_player
    where affected_player.external_identity_id = new.id
    group by affected_player.tournament_id
    having count(*) > 1
  ) then
    raise exception 'External identity appears more than once in the same tournament'
      using errcode = '23505';
  end if;

  -- Un même compte ou licencié ne peut pas prendre la place de deux joueurs
  -- dans un même tournoi. Les emails importés ne participent volontairement pas
  -- à ce contrôle car ils peuvent être des coordonnées d'équipe non fiables.
  if exists (
    select 1
    from public.tournament_team_players as affected_player
    join public.tournament_team_players as other_player
      on other_player.tournament_id = affected_player.tournament_id
     and other_player.id <> affected_player.id
    join public.tournament_teams as other_team
      on other_team.id = other_player.team_id
     and other_team.status in ('pending', 'accepted')
    left join public.tournament_external_player_identities as other_identity
      on other_identity.id = other_player.external_identity_id
    where affected_player.external_identity_id = new.id
      and (
        (
          target_member.id is not null
          and other_player.member_id = target_member.id
        )
        or (
          target_profile.id is not null
          and other_identity.status = 'verified'
          and other_identity.profile_id = target_profile.id
        )
      )
  ) then
    raise exception 'Account already represents another player in this tournament'
      using errcode = '23505';
  end if;

  update public.tournament_team_players as player
  set
    member_id = case
      when target_member.id is not null then target_member.id
      else player.member_id
    end,
    first_name = case
      when target_member.id is not null then target_member.first_name
      else new.first_name
    end,
    last_name = case
      when target_member.id is not null then target_member.last_name
      else new.last_name
    end,
    club_name = case
      when target_member.id is not null
        then coalesce(nullif(target_club_name, ''), player.club_name)
      else player.club_name
    end,
    email = case
      when target_profile.id is not null
        then target_profile.email
      else player.email
    end
  where player.external_identity_id = new.id;

  return new;
end;
$$;

revoke all on function public.sync_verified_external_identity_to_tournament_players()
from public, anon, authenticated;

create trigger sync_verified_external_identity_to_tournament_players
after insert or update of status, member_id, profile_id
on public.tournament_external_player_identities
for each row
execute function public.sync_verified_external_identity_to_tournament_players();

-- ---------------------------------------------------------------------------
-- Confirmation côté joueur. Le compte connecté doit porter exactement le même
-- prénom/nom normalisés que l'identité choisie. La confirmation rattache le
-- profil, mais ne fabrique jamais de licence.
-- ---------------------------------------------------------------------------

create or replace function public.claim_external_participation(
  target_external_identity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  current_profile public.profiles%rowtype;
  target_identity public.tournament_external_player_identities%rowtype;
  normalized_profile_first_name text;
  normalized_profile_last_name text;
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = current_profile_id;

  if current_profile.id is null then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  select identity.*
  into target_identity
  from public.tournament_external_player_identities as identity
  where identity.id = target_external_identity_id
  for update;

  if target_identity.id is null then
    raise exception 'External participation not found' using errcode = 'P0002';
  end if;

  -- Idempotence après confirmation email ou reconnexion.
  if target_identity.status = 'verified'
    and target_identity.profile_id = current_profile.id then
    return jsonb_build_object(
      'externalIdentityId', target_identity.id,
      'linked', true
    );
  end if;

  if target_identity.status <> 'unmatched'
    or target_identity.profile_id is not null
    or target_identity.member_id is not null then
    raise exception 'External participation is no longer available'
      using errcode = 'P0001';
  end if;

  normalized_profile_first_name := public.normalize_member_identity(
    coalesce(current_profile.first_name, '')
  );
  normalized_profile_last_name := public.normalize_member_identity(
    coalesce(current_profile.last_name, '')
  );

  if normalized_profile_first_name = ''
    or normalized_profile_last_name = ''
    or normalized_profile_first_name <> target_identity.first_name_normalized
    or normalized_profile_last_name <> target_identity.last_name_normalized then
    raise exception 'External participation identity does not match profile'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.tournament_team_players as player
    join public.tournament_teams as team
      on team.id = player.team_id
     and team.tournament_id = player.tournament_id
    where player.external_identity_id = target_identity.id
      and team.status in ('pending', 'accepted')
      and exists (
        select 1
        from public.tournament_import_team_refs as import_ref
        join public.tournament_imports as import_row
          on import_row.id = import_ref.import_id
         and import_row.status = 'imported'
        where import_ref.team_id = team.id
          and import_row.tournament_id = player.tournament_id
      )
  ) then
    raise exception 'External participation is not claimable'
      using errcode = 'P0001';
  end if;

  -- Un compte ne peut pas être confirmé comme deux joueurs différents d'un
  -- même tournoi. Le contrôle repose uniquement sur les liens de compte/licence.
  if exists (
    select 1
    from public.tournament_team_players as selected_player
    join public.tournament_team_players as other_player
      on other_player.tournament_id = selected_player.tournament_id
     and other_player.id <> selected_player.id
    left join public.tournament_external_player_identities as other_identity
      on other_identity.id = other_player.external_identity_id
    where selected_player.external_identity_id = target_identity.id
      and (
        (
          other_identity.status = 'verified'
          and other_identity.profile_id = current_profile.id
        )
        or (
          current_profile.member_id is not null
          and other_player.member_id = current_profile.member_id
        )
      )
  ) then
    raise exception 'Account already represents another player in this tournament'
      using errcode = '23505';
  end if;

  update public.tournament_external_player_identities as identity
  set
    profile_id = current_profile.id,
    member_id = current_profile.member_id,
    status = 'verified',
    verification_method = 'self_name_confirmation',
    verified_at = now(),
    verified_by = current_profile.id,
    updated_at = now()
  where identity.id = target_identity.id;

  return jsonb_build_object(
    'externalIdentityId', target_identity.id,
    'linked', true
  );
end;
$$;

revoke all on function public.claim_external_participation(uuid)
from public, anon, authenticated;
grant execute on function public.claim_external_participation(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Si le club du joueur rejoint plus tard Pelote Manager et que le profil est
-- relié à une vraie fiche licencié, le même compte conserve ses participations
-- et l'identité externe récupère ce member_id. Les changements d'email du compte
-- sont également propagés aux lignes joueur utilisées par les autorisations.
-- ---------------------------------------------------------------------------

create or replace function public.sync_profile_to_external_identities()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.member_id is not null then
    -- Cas historique : une identité avait déjà été reliée au licencié avant que
    -- celui-ci ne crée son compte.
    update public.tournament_external_player_identities as identity
    set
      profile_id = new.id,
      updated_at = now()
    where identity.status = 'verified'
      and identity.member_id = new.member_id
      and (identity.profile_id is null or identity.profile_id = new.id);

    -- Cas PR130 : le compte avait d'abord confirmé sa participation, puis sa
    -- licence a été reliée ultérieurement.
    update public.tournament_external_player_identities as identity
    set
      member_id = new.member_id,
      updated_at = now()
    where identity.status = 'verified'
      and identity.profile_id = new.id
      and identity.member_id is null;
  end if;

  update public.tournament_team_players as player
  set email = new.email
  where exists (
    select 1
    from public.tournament_external_player_identities as identity
    where identity.id = player.external_identity_id
      and identity.status = 'verified'
      and identity.profile_id = new.id
  );

  return new;
end;
$$;

revoke all on function public.sync_profile_to_external_identities()
from public, anon, authenticated;

create trigger sync_profile_to_external_identities
after insert or update of member_id, email
on public.profiles
for each row
execute function public.sync_profile_to_external_identities();

comment on function public.find_external_participation_candidates(text, text) is
  'Propose les participations externes non rattachées correspondant exactement au prénom et au nom, sans exposer de coordonnées importées.';
comment on function public.claim_external_participation(uuid) is
  'Rattache volontairement une participation externe au profil connecté après contrôle du prénom et du nom ; ne valide aucune licence.';
comment on function public.sync_profile_to_external_identities() is
  'Conserve le lien des identités externes quand un profil obtient plus tard une fiche licencié ou change d email.';

commit;
