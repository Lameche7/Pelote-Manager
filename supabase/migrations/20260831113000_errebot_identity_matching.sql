begin;

-- PR125 — Prévisualisation sécurisée du rapprochement des identités Errebot.
--
-- Cette étape ne persiste aucune décision. Elle ne fait que comparer les
-- identités structurées extraites dans le navigateur avec le registre des
-- licenciés et les identités externes déjà vérifiées.
--
-- Règle de sécurité centrale : prénom + nom + téléphone peuvent produire
-- une suggestion, mais jamais une nouvelle vérification automatique.
-- Seule une identité externe déjà vérifiée lors d'un rapprochement antérieur
-- peut être réutilisée avec le statut verified.

create or replace function public.admin_preview_errebot_identity_matches(
  payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  item jsonb;
  result jsonb := '[]'::jsonb;
  external_key text;
  team_external_id text;
  player_index integer;
  first_name text;
  last_name text;
  phone text;
  first_name_normalized text;
  last_name_normalized text;
  phone_normalized text;
  existing_identity public.tournament_external_player_identities%rowtype;
  candidate public.club_members%rowtype;
  candidate_profile_id uuid;
  candidate_club_name text;
  exact_count integer;
  name_count integer;
  phone_conflict_count integer;
  match_status text;
  match_reason text;
  matched_member_id uuid;
  matched_profile_id uuid;
  matched_member_name text;
  matched_licence_number text;
  matched_club_id uuid;
  matched_club_name text;
  matched_linked_account boolean;
  matched_member_active boolean;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(payload, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(payload) > 1000 then
    raise exception 'Errebot identity matching payload is invalid'
      using errcode = '22023';
  end if;

  for item in
    select value from jsonb_array_elements(payload)
  loop
    external_key := btrim(coalesce(item->>'externalKey', ''));
    team_external_id := btrim(coalesce(item->>'teamExternalId', ''));
    player_index := nullif(item->>'playerIndex', '')::integer;
    first_name := btrim(coalesce(item->>'firstName', ''));
    last_name := btrim(coalesce(item->>'lastName', ''));
    phone := btrim(coalesce(item->>'phone', ''));

    if external_key = ''
      or team_external_id = ''
      or player_index not in (1, 2)
      or first_name = ''
      or last_name = '' then
      raise exception 'Errebot identity matching payload is invalid'
        using errcode = '22023';
    end if;

    first_name_normalized := public.normalize_member_identity(first_name);
    last_name_normalized := public.normalize_member_identity(last_name);
    phone_normalized := public.normalize_tournament_phone(phone);

    existing_identity := null;
    candidate := null;
    candidate_profile_id := null;
    candidate_club_name := null;
    exact_count := 0;
    name_count := 0;
    phone_conflict_count := 0;
    match_status := 'unmatched';
    match_reason := 'no_match';
    matched_member_id := null;
    matched_profile_id := null;
    matched_member_name := null;
    matched_licence_number := null;
    matched_club_id := null;
    matched_club_name := null;
    matched_linked_account := false;
    matched_member_active := false;

    -- Une vérification antérieure est la seule preuve réutilisable sans
    -- nouvelle intervention humaine. Le téléphone reste ici une partie de
    -- l'identité externe déjà vérifiée, pas une preuve autonome.
    if phone_normalized <> '' then
      select identity.*
      into existing_identity
      from public.tournament_external_player_identities as identity
      where identity.source = 'errebot'
        and identity.first_name_normalized = first_name_normalized
        and identity.last_name_normalized = last_name_normalized
        and identity.phone_normalized = phone_normalized
        and identity.status = 'verified'
        and identity.profile_id is not null
      limit 1;
    end if;

    if existing_identity.id is not null then
      match_status := 'verified';
      match_reason := 'reused_verified_identity';
      matched_member_id := existing_identity.member_id;
      matched_profile_id := existing_identity.profile_id;
      matched_linked_account := true;

      if matched_member_id is not null then
        select
          member.first_name || ' ' || member.last_name,
          member.licence_number,
          member.club_id,
          club.name,
          member.is_active
        into
          matched_member_name,
          matched_licence_number,
          matched_club_id,
          matched_club_name,
          matched_member_active
        from public.club_members as member
        join public.clubs as club on club.id = member.club_id
        where member.id = matched_member_id;
      end if;
    else
      if phone_normalized <> '' then
        select count(*)::integer
        into exact_count
        from public.club_members as member
        where member.first_name_normalized = first_name_normalized
          and member.last_name_normalized = last_name_normalized
          and public.normalize_tournament_phone(coalesce(member.phone, '')) = phone_normalized;
      end if;

      select count(*)::integer
      into name_count
      from public.club_members as member
      where member.first_name_normalized = first_name_normalized
        and member.last_name_normalized = last_name_normalized;

      if phone_normalized <> '' then
        select count(*)::integer
        into phone_conflict_count
        from public.club_members as member
        where public.normalize_tournament_phone(coalesce(member.phone, '')) = phone_normalized
          and (
            member.first_name_normalized <> first_name_normalized
            or member.last_name_normalized <> last_name_normalized
          );
      end if;

      if exact_count = 1 then
        select member.*
        into candidate
        from public.club_members as member
        where member.first_name_normalized = first_name_normalized
          and member.last_name_normalized = last_name_normalized
          and public.normalize_tournament_phone(coalesce(member.phone, '')) = phone_normalized
        limit 1;

        match_status := case when candidate.is_active then 'suggested' else 'conflict' end;
        match_reason := case when candidate.is_active then 'exact_name_phone' else 'inactive_member' end;
      elsif exact_count > 1 then
        match_status := 'conflict';
        match_reason := 'ambiguous_exact';
      elsif name_count = 1 then
        select member.*
        into candidate
        from public.club_members as member
        where member.first_name_normalized = first_name_normalized
          and member.last_name_normalized = last_name_normalized
        limit 1;

        if not candidate.is_active then
          match_status := 'conflict';
          match_reason := 'inactive_member';
        elsif phone_normalized <> ''
          and public.normalize_tournament_phone(coalesce(candidate.phone, '')) <> ''
          and public.normalize_tournament_phone(coalesce(candidate.phone, '')) <> phone_normalized then
          match_status := 'conflict';
          match_reason := 'name_phone_mismatch';
        else
          match_status := 'suggested';
          match_reason := 'unique_name';
        end if;
      elsif name_count > 1 then
        match_status := 'conflict';
        match_reason := 'ambiguous_name';
      elsif phone_conflict_count > 0 then
        match_status := 'conflict';
        match_reason := 'phone_name_conflict';
      end if;

      if candidate.id is not null then
        select profile.id
        into candidate_profile_id
        from public.profiles as profile
        where profile.member_id = candidate.id
        limit 1;

        select club.name
        into candidate_club_name
        from public.clubs as club
        where club.id = candidate.club_id;

        matched_member_id := candidate.id;
        matched_profile_id := candidate_profile_id;
        matched_member_name := candidate.first_name || ' ' || candidate.last_name;
        matched_licence_number := candidate.licence_number;
        matched_club_id := candidate.club_id;
        matched_club_name := candidate_club_name;
        matched_linked_account := candidate_profile_id is not null;
        matched_member_active := candidate.is_active;
      end if;
    end if;

    result := result || jsonb_build_array(jsonb_build_object(
      'externalKey', external_key,
      'teamExternalId', team_external_id,
      'playerIndex', player_index,
      'firstName', first_name,
      'lastName', last_name,
      'status', match_status,
      'reason', match_reason,
      'externalIdentityId', existing_identity.id,
      'memberId', matched_member_id,
      'profileId', matched_profile_id,
      'memberDisplayName', matched_member_name,
      'licenceNumber', matched_licence_number,
      'clubId', matched_club_id,
      'clubName', matched_club_name,
      'linkedAccount', matched_linked_account,
      'memberActive', matched_member_active
    ));
  end loop;

  return result;
end;
$$;

revoke all on function public.admin_preview_errebot_identity_matches(jsonb)
from public, anon;
grant execute on function public.admin_preview_errebot_identity_matches(jsonb)
to authenticated;

commit;
