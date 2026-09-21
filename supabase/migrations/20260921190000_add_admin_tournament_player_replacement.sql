begin;

create or replace function public.admin_replace_tournament_player(
  target_team_id uuid,
  target_role text,
  replacement jsonb,
  replacement_reason text default 'Blessure'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_team public.tournament_teams%rowtype;
  target_tournament public.tournaments%rowtype;
  old_player public.tournament_team_players%rowtype;
  old_identity public.tournament_external_player_identities%rowtype;
  replacement_identity public.tournament_external_player_identities%rowtype;
  replacement_member public.club_members%rowtype;
  replacement_profile public.profiles%rowtype;
  replacement_member_id uuid := nullif(replacement->>'member_id', '')::uuid;
  replacement_first_name text := btrim(coalesce(replacement->>'first_name', ''));
  replacement_last_name text := btrim(coalesce(replacement->>'last_name', ''));
  replacement_club_name text := btrim(coalesce(replacement->>'club_name', ''));
  replacement_email text := lower(btrim(coalesce(replacement->>'email', '')));
  replacement_phone text := btrim(coalesce(replacement->>'phone', ''));
  normalized_first_name text;
  normalized_last_name text;
  normalized_phone text;
  old_profile_id uuid;
  replacement_profile_id uuid;
  reason_text text := btrim(coalesce(replacement_reason, ''));
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if target_role not in ('front', 'back') then
    raise exception 'Tournament player role is invalid' using errcode = '22023';
  end if;

  select team.*
  into target_team
  from public.tournament_teams as team
  where team.id = target_team_id
  for update;

  if target_team.id is null then
    raise exception 'Tournament team not found' using errcode = 'P0002';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_team.tournament_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if not public.has_club_permission(target_tournament.club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if target_team.status not in ('pending', 'accepted') then
    raise exception 'Tournament team is not active' using errcode = 'P0001';
  end if;

  if target_tournament.status in ('completed', 'archived', 'cancelled') then
    raise exception 'Tournament player replacement is closed' using errcode = 'P0001';
  end if;

  select player.*
  into old_player
  from public.tournament_team_players as player
  where player.team_id = target_team.id
    and player.role::text = target_role
  for update;

  if old_player.id is null then
    raise exception 'Tournament player not found' using errcode = 'P0002';
  end if;

  if reason_text = '' then reason_text := 'Remplacement'; end if;

  if replacement_member_id is not null then
    select member.*
    into replacement_member
    from public.club_members as member
    where member.id = replacement_member_id
      and member.is_active;

    if replacement_member.id is null then
      raise exception 'Tournament member is invalid' using errcode = '22023';
    end if;

    replacement_first_name := btrim(replacement_member.first_name);
    replacement_last_name := btrim(replacement_member.last_name);

    select club.name
    into replacement_club_name
    from public.clubs as club
    where club.id = replacement_member.club_id;

    replacement_email := lower(
      btrim(coalesce(nullif(replacement_member.email, ''), replacement_email))
    );
    replacement_phone := btrim(
      coalesce(nullif(replacement_member.phone, ''), replacement_phone)
    );
  end if;

  if replacement_first_name = ''
    or replacement_last_name = ''
    or replacement_club_name = ''
    or replacement_email = ''
    or replacement_phone = '' then
    raise exception 'Tournament replacement player fields are incomplete'
      using errcode = '22023';
  end if;

  normalized_first_name := public.normalize_member_identity(replacement_first_name);
  normalized_last_name := public.normalize_member_identity(replacement_last_name);
  normalized_phone := public.normalize_tournament_phone(replacement_phone);

  if normalized_first_name = '' or normalized_last_name = '' then
    raise exception 'Tournament replacement player fields are incomplete'
      using errcode = '22023';
  end if;

  if public.normalize_member_identity(old_player.first_name) = normalized_first_name
    and public.normalize_member_identity(old_player.last_name) = normalized_last_name
    and lower(btrim(coalesce(old_player.email, ''))) = replacement_email
    and public.normalize_tournament_phone(coalesce(old_player.phone, '')) = normalized_phone then
    raise exception 'Replacement player is unchanged' using errcode = 'P0001';
  end if;

  if replacement_member_id is not null and exists (
    select 1
    from public.tournament_team_players as other_player
    join public.tournament_teams as other_team
      on other_team.id = other_player.team_id
     and other_team.tournament_id = other_player.tournament_id
    where other_player.tournament_id = target_team.tournament_id
      and other_player.id <> old_player.id
      and other_team.series_id = target_team.series_id
      and other_team.status in ('pending', 'accepted')
      and other_player.member_id = replacement_member_id
  ) then
    raise exception 'A player can only belong to one active team per tournament series'
      using errcode = '23505';
  end if;

  if replacement_member_id is not null then
    select profile.*
    into replacement_profile
    from public.profiles as profile
    where profile.member_id = replacement_member_id
    order by profile.created_at
    limit 1;
  end if;

  if replacement_profile.id is null then
    select profile.*
    into replacement_profile
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where lower(btrim(coalesce(profile.email, ''))) = replacement_email
      and auth_user.email_confirmed_at is not null
      and public.normalize_member_identity(coalesce(profile.first_name, '')) = normalized_first_name
      and public.normalize_member_identity(coalesce(profile.last_name, '')) = normalized_last_name
    order by profile.created_at
    limit 1;
  end if;

  replacement_profile_id := replacement_profile.id;

  if replacement_profile_id is not null
    and replacement_member_id is not null
    and replacement_profile.member_id is not null
    and replacement_profile.member_id <> replacement_member_id then
    raise exception 'Replacement account/member link is inconsistent'
      using errcode = '23505';
  end if;

  if replacement_profile_id is not null and exists (
    select 1
    from public.tournament_team_players as other_player
    join public.tournament_teams as other_team
      on other_team.id = other_player.team_id
     and other_team.tournament_id = other_player.tournament_id
    join public.tournament_external_player_identities as other_identity
      on other_identity.id = other_player.external_identity_id
    where other_player.tournament_id = target_team.tournament_id
      and other_player.id <> old_player.id
      and other_team.series_id = target_team.series_id
      and other_team.status in ('pending', 'accepted')
      and other_identity.status = 'verified'
      and other_identity.profile_id = replacement_profile_id
  ) then
    raise exception 'Account already represents another player in this tournament series'
      using errcode = '23505';
  end if;

  select identity.*
  into replacement_identity
  from public.tournament_external_player_identities as identity
  where identity.source = 'admin_replacement'
    and identity.first_name_normalized = normalized_first_name
    and identity.last_name_normalized = normalized_last_name
    and identity.phone_normalized = normalized_phone
    and (
      replacement_profile_id is null
      or identity.profile_id is null
      or identity.profile_id = replacement_profile_id
    )
  order by identity.updated_at desc, identity.created_at desc
  limit 1;

  if replacement_identity.id is not null and exists (
    select 1
    from public.tournament_team_players as other_player
    join public.tournament_teams as other_team
      on other_team.id = other_player.team_id
     and other_team.tournament_id = other_player.tournament_id
    where other_player.external_identity_id = replacement_identity.id
      and other_player.id <> old_player.id
      and other_player.tournament_id = target_team.tournament_id
      and other_team.series_id = target_team.series_id
      and other_team.status in ('pending', 'accepted')
  ) then
    raise exception 'Replacement player already participates in this tournament series'
      using errcode = '23505';
  end if;

  if replacement_identity.id is null then
    insert into public.tournament_external_player_identities (
      source,
      first_name,
      last_name,
      phone,
      first_name_normalized,
      last_name_normalized,
      phone_normalized,
      profile_id,
      member_id,
      status,
      verification_method,
      verified_at,
      verified_by
    )
    values (
      'admin_replacement',
      replacement_first_name,
      replacement_last_name,
      replacement_phone,
      normalized_first_name,
      normalized_last_name,
      normalized_phone,
      replacement_profile_id,
      coalesce(replacement_member_id, replacement_profile.member_id),
      case
        when replacement_profile_id is not null or replacement_member_id is not null
          then 'verified'
        else 'unmatched'
      end,
      case
        when replacement_profile_id is not null then 'admin_replacement_account'
        when replacement_member_id is not null then 'admin_replacement_member'
        else null
      end,
      case
        when replacement_profile_id is not null or replacement_member_id is not null
          then now()
        else null
      end,
      case
        when replacement_profile_id is not null or replacement_member_id is not null
          then actor_id
        else null
      end
    )
    returning *
    into replacement_identity;
  else
    update public.tournament_external_player_identities as identity
    set
      first_name = replacement_first_name,
      last_name = replacement_last_name,
      phone = replacement_phone,
      first_name_normalized = normalized_first_name,
      last_name_normalized = normalized_last_name,
      phone_normalized = normalized_phone,
      profile_id = coalesce(replacement_profile_id, identity.profile_id),
      member_id = coalesce(replacement_member_id, replacement_profile.member_id, identity.member_id),
      status = case
        when replacement_profile_id is not null
          or replacement_member_id is not null
          or identity.profile_id is not null
          or identity.member_id is not null
          then 'verified'
        else 'unmatched'
      end,
      verification_method = case
        when replacement_profile_id is not null then 'admin_replacement_account'
        when replacement_member_id is not null then 'admin_replacement_member'
        else identity.verification_method
      end,
      verified_at = case
        when replacement_profile_id is not null
          or replacement_member_id is not null
          or identity.profile_id is not null
          or identity.member_id is not null
          then coalesce(identity.verified_at, now())
        else null
      end,
      verified_by = case
        when replacement_profile_id is not null or replacement_member_id is not null
          then actor_id
        else identity.verified_by
      end,
      updated_at = now()
    where identity.id = replacement_identity.id
    returning *
    into replacement_identity;
  end if;

  if old_player.external_identity_id is not null then
    select identity.*
    into old_identity
    from public.tournament_external_player_identities as identity
    where identity.id = old_player.external_identity_id;
  end if;

  old_profile_id := old_identity.profile_id;

  if old_profile_id is null
    and old_player.member_id is not null
    and target_team.submitted_by is not null
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = target_team.submitted_by
        and profile.member_id = old_player.member_id
    ) then
    old_profile_id := target_team.submitted_by;
  end if;

  if old_profile_id is null
    and target_team.submitted_by is not null
    and lower(btrim(coalesce(old_player.email, ''))) <> ''
    and exists (
      select 1
      from public.profiles as profile
      where profile.id = target_team.submitted_by
        and lower(btrim(coalesce(profile.email, ''))) =
            lower(btrim(coalesce(old_player.email, '')))
        and public.normalize_member_identity(coalesce(profile.first_name, '')) =
            public.normalize_member_identity(old_player.first_name)
        and public.normalize_member_identity(coalesce(profile.last_name, '')) =
            public.normalize_member_identity(old_player.last_name)
    ) then
    old_profile_id := target_team.submitted_by;
  end if;

  update public.tournament_team_players as player
  set
    member_id = replacement_member_id,
    first_name = replacement_first_name,
    last_name = replacement_last_name,
    club_name = replacement_club_name,
    email = replacement_email,
    phone = replacement_phone,
    external_identity_id = replacement_identity.id
  where player.id = old_player.id;

  update public.tournament_teams as team
  set
    submitted_by = case
      when old_profile_id is not null and team.submitted_by = old_profile_id then null
      else team.submitted_by
    end,
    contact_email = case
      when lower(btrim(coalesce(team.contact_email, ''))) =
           lower(btrim(coalesce(old_player.email, '')))
        then replacement_email
      else team.contact_email
    end,
    contact_phone = case
      when public.normalize_tournament_phone(coalesce(team.contact_phone, '')) =
           public.normalize_tournament_phone(coalesce(old_player.phone, ''))
        then replacement_phone
      else team.contact_phone
    end,
    updated_at = now()
  where team.id = target_team.id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament.id,
    'tournament_player_replaced',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'team_id', target_team.id,
      'series_id', target_team.series_id,
      'role', target_role,
      'reason', reason_text,
      'before', jsonb_build_object(
        'player_id', old_player.id,
        'first_name', old_player.first_name,
        'last_name', old_player.last_name,
        'club_name', old_player.club_name,
        'email', old_player.email,
        'phone', old_player.phone,
        'member_id', old_player.member_id,
        'external_identity_id', old_player.external_identity_id,
        'profile_id', old_profile_id
      ),
      'after', jsonb_build_object(
        'player_id', old_player.id,
        'first_name', replacement_first_name,
        'last_name', replacement_last_name,
        'club_name', replacement_club_name,
        'email', replacement_email,
        'phone', replacement_phone,
        'member_id', replacement_member_id,
        'external_identity_id', replacement_identity.id,
        'profile_id', replacement_profile_id
      )
    ),
    actor_id
  );

  return jsonb_build_object(
    'team_id', target_team.id,
    'player_id', old_player.id,
    'external_identity_id', replacement_identity.id,
    'profile_id', replacement_profile_id,
    'account_linked', replacement_profile_id is not null
  );
end;
$$;

revoke all on function public.admin_replace_tournament_player(uuid, text, jsonb, text)
from public, anon, authenticated;
grant execute on function public.admin_replace_tournament_player(uuid, text, jsonb, text)
to authenticated;

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
      where identity.profile_id is null
        and identity.first_name_normalized = normalized_first_name
        and identity.last_name_normalized = normalized_last_name
        and team.status in ('pending', 'accepted')
        and tournament.status <> 'cancelled'
        and (
          (
            identity.source = 'admin_replacement'
            and identity.status in ('unmatched', 'verified')
          )
          or (
            identity.status = 'unmatched'
            and identity.member_id is null
            and exists (
              select 1
              from public.tournament_import_team_refs as import_ref
              join public.tournament_imports as import_row
                on import_row.id = import_ref.import_id
               and import_row.status = 'imported'
              where import_ref.team_id = team.id
                and import_row.tournament_id = tournament.id
            )
          )
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
  replacement_claim boolean := false;
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

  if target_identity.status = 'verified'
    and target_identity.profile_id = current_profile.id then
    return jsonb_build_object(
      'externalIdentityId', target_identity.id,
      'linked', true
    );
  end if;

  replacement_claim := target_identity.source = 'admin_replacement'
    and target_identity.profile_id is null
    and target_identity.status in ('unmatched', 'verified');

  if not replacement_claim
    and (
      target_identity.status <> 'unmatched'
      or target_identity.profile_id is not null
      or target_identity.member_id is not null
    ) then
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

  if replacement_claim and not exists (
    select 1
    from auth.users as auth_user
    join public.tournament_team_players as player
      on player.external_identity_id = target_identity.id
    join public.tournament_teams as team
      on team.id = player.team_id
     and team.tournament_id = player.tournament_id
    where auth_user.id = current_profile.id
      and auth_user.email_confirmed_at is not null
      and lower(btrim(coalesce(auth_user.email, ''))) =
          lower(btrim(coalesce(player.email, '')))
      and btrim(coalesce(player.email, '')) <> ''
      and team.status in ('pending', 'accepted')
  ) then
    raise exception 'Replacement participation email does not match profile'
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
      and (
        replacement_claim
        or exists (
          select 1
          from public.tournament_import_team_refs as import_ref
          join public.tournament_imports as import_row
            on import_row.id = import_ref.import_id
           and import_row.status = 'imported'
          where import_ref.team_id = team.id
            and import_row.tournament_id = player.tournament_id
        )
      )
  ) then
    raise exception 'External participation is not claimable'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.tournament_team_players as selected_player
    join public.tournament_teams as selected_team
      on selected_team.id = selected_player.team_id
     and selected_team.tournament_id = selected_player.tournament_id
    join public.tournament_team_players as other_player
      on other_player.tournament_id = selected_player.tournament_id
     and other_player.id <> selected_player.id
    join public.tournament_teams as other_team
      on other_team.id = other_player.team_id
     and other_team.tournament_id = selected_team.tournament_id
     and other_team.series_id = selected_team.series_id
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
    raise exception 'Account already represents another player in this tournament series'
      using errcode = '23505';
  end if;

  update public.tournament_external_player_identities as identity
  set
    profile_id = current_profile.id,
    member_id = coalesce(identity.member_id, current_profile.member_id),
    status = 'verified',
    verification_method = case
      when replacement_claim then 'self_email_name_confirmation'
      else 'self_name_confirmation'
    end,
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

comment on function public.admin_replace_tournament_player(uuid, text, jsonb, text) is
  'Remplace atomiquement un joueur sans modifier la série, la poule, le planning ni les matchs. Le remplaçant obtient une identité tournoi réclamable par son futur compte.';

comment on function public.find_external_participation_candidates(text, text) is
  'Propose les participations externes importées ou créées lors d un remplacement administrateur, sans exposer les coordonnées.';

comment on function public.claim_external_participation(uuid) is
  'Rattache une participation externe au profil connecté ; les remplacements administrateur exigent aussi un email confirmé identique à celui saisi par le club.';

commit;
