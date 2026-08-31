begin;

-- PR125 — Validation explicite et recherche contrôlée des identités Errebot.
-- Une validation administrateur rattache une identité externe à un licencié
-- existant. Un compte utilisateur n'est pas requis : le registre des licenciés
-- reste la source métier, profiles.member_id n'est qu'un lien de compte.

alter table public.tournament_external_player_identities
add column if not exists verified_by uuid
references public.profiles (id) on delete set null;

do $$
declare
  constraint_name text;
begin
  select constraint.conname
  into constraint_name
  from pg_constraint as constraint
  where constraint.conrelid = 'public.tournament_external_player_identities'::regclass
    and constraint.contype = 'c'
    and pg_get_constraintdef(constraint.oid) ilike '%status <> ''verified''%'
  limit 1;

  if constraint_name is not null then
    execute format(
      'alter table public.tournament_external_player_identities drop constraint %I',
      constraint_name
    );
  end if;
end;
$$;

alter table public.tournament_external_player_identities
add constraint tournament_external_player_verified_link_check
check (
  status <> 'verified'
  or (
    verified_at is not null
    and (member_id is not null or profile_id is not null)
  )
);

create or replace function public.admin_search_errebot_identity_candidates(
  search_text text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  normalized_search text := public.normalize_member_identity(
    btrim(coalesce(search_text, ''))
  );
  normalized_licence text := public.normalize_member_licence(
    btrim(coalesce(search_text, ''))
  );
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if length(btrim(coalesce(search_text, ''))) < 2 then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', candidate.id,
          'displayName', candidate.first_name || ' ' || candidate.last_name,
          'licenceNumber', candidate.licence_number,
          'clubName', candidate.club_name,
          'linkedAccount', candidate.linked_account,
          'memberActive', candidate.is_active
        )
        order by candidate.last_name, candidate.first_name, candidate.club_name
      ),
      '[]'::jsonb
    )
    from (
      select
        member.id,
        member.first_name,
        member.last_name,
        member.licence_number,
        member.is_active,
        club.name as club_name,
        exists (
          select 1
          from public.profiles as profile
          where profile.member_id = member.id
        ) as linked_account
      from public.club_members as member
      join public.clubs as club on club.id = member.club_id
      where member.is_active
        and (
          public.normalize_member_identity(member.first_name || member.last_name)
            like '%' || normalized_search || '%'
          or member.licence_number_normalized
            like '%' || normalized_licence || '%'
        )
      order by member.last_name_normalized, member.first_name_normalized, club.name
      limit 12
    ) as candidate
  );
end;
$$;

create or replace function public.admin_confirm_errebot_identity_match(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_member_id uuid := nullif(payload->>'memberId', '')::uuid;
  external_key text := btrim(coalesce(payload->>'externalKey', ''));
  team_external_id text := btrim(coalesce(payload->>'teamExternalId', ''));
  player_index integer := nullif(payload->>'playerIndex', '')::integer;
  first_name text := btrim(coalesce(payload->>'firstName', ''));
  last_name text := btrim(coalesce(payload->>'lastName', ''));
  phone text := btrim(coalesce(payload->>'phone', ''));
  input_first_name_normalized text;
  input_last_name_normalized text;
  input_phone_normalized text;
  existing_identity public.tournament_external_player_identities%rowtype;
  target_member public.club_members%rowtype;
  target_profile_id uuid;
  target_club_name text;
  identity_id uuid;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if target_member_id is null
    or external_key = ''
    or team_external_id = ''
    or player_index is null
    or player_index not in (1, 2)
    or first_name = ''
    or last_name = '' then
    raise exception 'Errebot identity confirmation payload is invalid'
      using errcode = '22023';
  end if;

  select member.*
  into target_member
  from public.club_members as member
  where member.id = target_member_id
    and member.is_active
  for share;

  if target_member.id is null then
    raise exception 'Tournament member is invalid' using errcode = '22023';
  end if;

  select profile.id
  into target_profile_id
  from public.profiles as profile
  where profile.member_id = target_member.id
  limit 1;

  select club.name
  into target_club_name
  from public.clubs as club
  where club.id = target_member.club_id;

  input_first_name_normalized := public.normalize_member_identity(first_name);
  input_last_name_normalized := public.normalize_member_identity(last_name);
  input_phone_normalized := public.normalize_tournament_phone(phone);

  select identity.*
  into existing_identity
  from public.tournament_external_player_identities as identity
  where identity.source = 'errebot'
    and identity.first_name_normalized = input_first_name_normalized
    and identity.last_name_normalized = input_last_name_normalized
    and identity.phone_normalized = input_phone_normalized
  order by (identity.status = 'verified') desc, identity.updated_at desc
  limit 1
  for update;

  if existing_identity.id is not null
    and existing_identity.status = 'verified'
    and existing_identity.member_id is not null
    and existing_identity.member_id <> target_member.id then
    raise exception 'Errebot identity is already verified to another member'
      using errcode = 'P0001';
  end if;

  if existing_identity.id is null then
    insert into public.tournament_external_player_identities (
      source,
      first_name,
      last_name,
      phone,
      profile_id,
      member_id,
      status,
      verification_method,
      verified_at,
      verified_by
    )
    values (
      'errebot',
      first_name,
      last_name,
      phone,
      target_profile_id,
      target_member.id,
      'verified',
      'admin_confirmation',
      now(),
      auth.uid()
    )
    returning id into identity_id;
  else
    update public.tournament_external_player_identities
    set
      first_name = first_name,
      last_name = last_name,
      phone = phone,
      profile_id = target_profile_id,
      member_id = target_member.id,
      status = 'verified',
      verification_method = 'admin_confirmation',
      verified_at = now(),
      verified_by = auth.uid(),
      updated_at = now()
    where id = existing_identity.id
    returning id into identity_id;
  end if;

  return jsonb_build_object(
    'externalKey', external_key,
    'teamExternalId', team_external_id,
    'playerIndex', player_index,
    'firstName', first_name,
    'lastName', last_name,
    'status', 'verified',
    'reason', 'admin_confirmed',
    'externalIdentityId', identity_id,
    'memberId', target_member.id,
    'profileId', target_profile_id,
    'memberDisplayName', target_member.first_name || ' ' || target_member.last_name,
    'licenceNumber', target_member.licence_number,
    'clubId', target_member.club_id,
    'clubName', target_club_name,
    'linkedAccount', target_profile_id is not null,
    'memberActive', target_member.is_active
  );
end;
$$;

-- Réécrit la prévisualisation pour qu'une identité vérifiée puisse être
-- réutilisée via member_id même si le licencié n'a pas encore de compte.
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
  input_first_name_normalized text;
  input_last_name_normalized text;
  input_phone_normalized text;
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

  for item in select value from jsonb_array_elements(payload)
  loop
    external_key := btrim(coalesce(item->>'externalKey', ''));
    team_external_id := btrim(coalesce(item->>'teamExternalId', ''));
    player_index := nullif(item->>'playerIndex', '')::integer;
    first_name := btrim(coalesce(item->>'firstName', ''));
    last_name := btrim(coalesce(item->>'lastName', ''));
    phone := btrim(coalesce(item->>'phone', ''));

    if external_key = ''
      or team_external_id = ''
      or player_index is null
      or player_index not in (1, 2)
      or first_name = ''
      or last_name = '' then
      raise exception 'Errebot identity matching payload is invalid'
        using errcode = '22023';
    end if;

    input_first_name_normalized := public.normalize_member_identity(first_name);
    input_last_name_normalized := public.normalize_member_identity(last_name);
    input_phone_normalized := public.normalize_tournament_phone(phone);

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

    if input_phone_normalized <> '' then
      select identity.*
      into existing_identity
      from public.tournament_external_player_identities as identity
      where identity.source = 'errebot'
        and identity.first_name_normalized = input_first_name_normalized
        and identity.last_name_normalized = input_last_name_normalized
        and identity.phone_normalized = input_phone_normalized
        and identity.status = 'verified'
        and (identity.member_id is not null or identity.profile_id is not null)
      limit 1;
    end if;

    if existing_identity.id is not null then
      match_status := 'verified';
      match_reason := 'reused_verified_identity';
      matched_member_id := existing_identity.member_id;
      matched_profile_id := existing_identity.profile_id;
      matched_linked_account := existing_identity.profile_id is not null;

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
      if input_phone_normalized <> '' then
        select count(*)::integer
        into exact_count
        from public.club_members as member
        where member.first_name_normalized = input_first_name_normalized
          and member.last_name_normalized = input_last_name_normalized
          and public.normalize_tournament_phone(coalesce(member.phone, '')) = input_phone_normalized;
      end if;

      select count(*)::integer
      into name_count
      from public.club_members as member
      where member.first_name_normalized = input_first_name_normalized
        and member.last_name_normalized = input_last_name_normalized;

      if input_phone_normalized <> '' then
        select count(*)::integer
        into phone_conflict_count
        from public.club_members as member
        where public.normalize_tournament_phone(coalesce(member.phone, '')) = input_phone_normalized
          and (
            member.first_name_normalized <> input_first_name_normalized
            or member.last_name_normalized <> input_last_name_normalized
          );
      end if;

      if exact_count = 1 then
        select member.*
        into candidate
        from public.club_members as member
        where member.first_name_normalized = input_first_name_normalized
          and member.last_name_normalized = input_last_name_normalized
          and public.normalize_tournament_phone(coalesce(member.phone, '')) = input_phone_normalized
        limit 1;

        match_status := case when candidate.is_active then 'suggested' else 'conflict' end;
        match_reason := case when candidate.is_active then 'exact_name_phone' else 'inactive_member' end;
      elsif exact_count > 1 then
        match_status := 'conflict';
        match_reason := 'ambiguous_exact';
      elsif phone_conflict_count > 0 then
        match_status := 'conflict';
        match_reason := 'phone_name_conflict';
      elsif name_count = 1 then
        select member.*
        into candidate
        from public.club_members as member
        where member.first_name_normalized = input_first_name_normalized
          and member.last_name_normalized = input_last_name_normalized
        limit 1;

        if not candidate.is_active then
          match_status := 'conflict';
          match_reason := 'inactive_member';
        elsif input_phone_normalized <> ''
          and public.normalize_tournament_phone(coalesce(candidate.phone, '')) <> ''
          and public.normalize_tournament_phone(coalesce(candidate.phone, '')) <> input_phone_normalized then
          match_status := 'conflict';
          match_reason := 'name_phone_mismatch';
        else
          match_status := 'suggested';
          match_reason := 'unique_name';
        end if;
      elsif name_count > 1 then
        match_status := 'conflict';
        match_reason := 'ambiguous_name';
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

revoke all on function public.admin_search_errebot_identity_candidates(text)
from public, anon;
revoke all on function public.admin_confirm_errebot_identity_match(jsonb)
from public, anon;
revoke all on function public.admin_preview_errebot_identity_matches(jsonb)
from public, anon;

grant execute on function public.admin_search_errebot_identity_candidates(text)
to authenticated;
grant execute on function public.admin_confirm_errebot_identity_match(jsonb)
to authenticated;
grant execute on function public.admin_preview_errebot_identity_matches(jsonb)
to authenticated;

commit;
