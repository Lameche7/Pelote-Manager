begin;

-- PR125 — Évite toute ambiguïté PL/pgSQL entre les valeurs du payload
-- et les colonnes first_name / last_name / phone lors de la confirmation.

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
  input_first_name text := btrim(coalesce(payload->>'firstName', ''));
  input_last_name text := btrim(coalesce(payload->>'lastName', ''));
  input_phone text := btrim(coalesce(payload->>'phone', ''));
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
    or input_first_name = ''
    or input_last_name = '' then
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

  input_first_name_normalized := public.normalize_member_identity(input_first_name);
  input_last_name_normalized := public.normalize_member_identity(input_last_name);
  input_phone_normalized := public.normalize_tournament_phone(input_phone);

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
      input_first_name,
      input_last_name,
      input_phone,
      target_profile_id,
      target_member.id,
      'verified',
      'admin_confirmation',
      now(),
      auth.uid()
    )
    returning id into identity_id;
  else
    update public.tournament_external_player_identities as identity
    set
      first_name = input_first_name,
      last_name = input_last_name,
      phone = input_phone,
      profile_id = target_profile_id,
      member_id = target_member.id,
      status = 'verified',
      verification_method = 'admin_confirmation',
      verified_at = now(),
      verified_by = auth.uid(),
      updated_at = now()
    where identity.id = existing_identity.id
    returning identity.id into identity_id;
  end if;

  return jsonb_build_object(
    'externalKey', external_key,
    'teamExternalId', team_external_id,
    'playerIndex', player_index,
    'firstName', input_first_name,
    'lastName', input_last_name,
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

revoke all on function public.admin_confirm_errebot_identity_match(jsonb)
from public, anon;
grant execute on function public.admin_confirm_errebot_identity_match(jsonb)
to authenticated;

commit;
