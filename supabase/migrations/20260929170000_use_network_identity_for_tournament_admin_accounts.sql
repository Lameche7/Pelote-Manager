begin;

CREATE OR REPLACE FUNCTION public.admin_link_tournament_account(target_external_identity_id uuid, target_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  current_club uuid := public.admin_current_club_id();
  target_identity public.tournament_external_player_identities%rowtype;
  target_profile public.profiles%rowtype;
  tournament_row record;
begin
  if actor_id is null
    or current_club is null
    or not public.has_club_permission(current_club, 'tournaments.manage')
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select identity.*
  into target_identity
  from public.tournament_external_player_identities as identity
  where identity.id = target_external_identity_id
  for update;

  if target_identity.id is null then
    raise exception 'External participation not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.tournament_team_players as player
    join public.tournaments as tournament on tournament.id = player.tournament_id
    where player.external_identity_id = target_identity.id
      and tournament.club_id = current_club
  ) then
    raise exception 'External participation not found' using errcode = 'P0002';
  end if;

  select profile.*
  into target_profile
  from public.profiles as profile
  where profile.id = target_profile_id;

  if target_profile.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if target_identity.status = 'verified'
    and target_identity.profile_id is not null
    and target_identity.profile_id <> target_profile.id
  then
    raise exception 'External participation is already linked to another account'
      using errcode = '23505';
  end if;

  if target_identity.status = 'verified'
    and target_identity.profile_id = target_profile.id
  then
    return jsonb_build_object('linked', true, 'profileId', target_profile.id);
  end if;

  update public.tournament_external_player_identities
  set
    profile_id = target_profile.id,
    member_id = public.profile_club_member_id(target_profile.id, current_club),
    status = 'verified',
    verification_method = 'admin_manual',
    verified_at = now(),
    verified_by = actor_id,
    updated_at = now()
  where id = target_identity.id;

  for tournament_row in
    select distinct tournament.id, tournament.status
    from public.tournament_team_players as player
    join public.tournaments as tournament on tournament.id = player.tournament_id
    where player.external_identity_id = target_identity.id
      and tournament.club_id = current_club
  loop
    insert into public.tournament_audit_log (
      tournament_id,
      action,
      before_status,
      after_status,
      payload,
      created_by
    ) values (
      tournament_row.id,
      'external_identity_admin_linked',
      tournament_row.status,
      tournament_row.status,
      jsonb_build_object(
        'externalIdentityId', target_identity.id,
        'profileId', target_profile.id
      ),
      actor_id
    );
  end loop;

  return jsonb_build_object(
    'linked', true,
    'profileId', target_profile.id,
    'externalIdentityId', target_identity.id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_list_tournament_account_audit(target_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_club uuid := public.admin_current_club_id();
begin
  if current_club is null
    or not public.has_club_permission(current_club, 'tournaments.manage')
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
      and tournament.club_id = current_club
  ) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return coalesce((
    with identities as (
      select distinct
        identity.id,
        identity.first_name,
        identity.last_name,
        identity.first_name_normalized,
        identity.last_name_normalized,
        identity.status,
        identity.profile_id,
        identity.member_id
      from public.tournament_external_player_identities as identity
      join public.tournament_team_players as player
        on player.external_identity_id = identity.id
      join public.tournament_teams as team
        on team.id = player.team_id
       and team.tournament_id = target_tournament_id
      where player.tournament_id = target_tournament_id
        and team.status in ('pending', 'accepted')
    )
    select jsonb_agg(
      jsonb_build_object(
        'externalIdentityId', identity.id,
        'firstName', identity.first_name,
        'lastName', identity.last_name,
        'status', case
          when identity.status = 'verified'
            and identity.profile_id is not null
            and linked_auth.email_confirmed_at is null
            then 'pending_confirmation'
          when identity.status = 'verified'
            and identity.profile_id is not null
            then 'recognized'
          when jsonb_array_length(candidates.items) > 0
            and coalesce((candidates.items->0->>'emailConfirmed')::boolean, false) = false
            then 'pending_confirmation'
          when jsonb_array_length(candidates.items) > 0
            then 'probable'
          else 'unmatched'
        end,
        'linkedProfile', case
          when linked_profile.id is null then null
          else jsonb_build_object(
            'id', linked_profile.id,
            'email', linked_profile.email,
            'firstName', linked_profile.first_name,
            'lastName', linked_profile.last_name,
            'displayName', linked_profile.display_name,
            'emailConfirmed', linked_auth.email_confirmed_at is not null
          )
        end,
        'participations', participations.items,
        'candidates', candidates.items
      )
      order by identity.last_name_normalized, identity.first_name_normalized
    )
    from identities as identity
    left join public.profiles as linked_profile
      on linked_profile.id = identity.profile_id
    left join auth.users as linked_auth
      on linked_auth.id = linked_profile.id
    cross join lateral (
      select coalesce(jsonb_agg(item order by item->>'seriesName'), '[]'::jsonb) as items
      from (
        select distinct jsonb_build_object(
          'teamId', team.id,
          'seriesName', series.name,
          'role', player.role,
          'partnerName', concat_ws(' ', partner.first_name, partner.last_name)
        ) as item
        from public.tournament_team_players as player
        join public.tournament_teams as team on team.id = player.team_id
        join public.tournament_series as series on series.id = team.series_id
        left join lateral (
          select other.first_name, other.last_name
          from public.tournament_team_players as other
          where other.team_id = team.id
            and other.id <> player.id
          order by other.display_order, other.id
          limit 1
        ) as partner on true
        where player.external_identity_id = identity.id
          and player.tournament_id = target_tournament_id
          and team.status in ('pending', 'accepted')
      ) as participation_rows
    ) as participations
    cross join lateral (
      select coalesce(
        jsonb_agg(candidate order by candidate->>'matchRank', candidate->>'lastName'),
        '[]'::jsonb
      ) as items
      from (
        select distinct jsonb_build_object(
          'id', profile.id,
          'email', profile.email,
          'firstName', coalesce(nullif(btrim(profile.first_name), ''), member.first_name),
          'lastName', coalesce(nullif(btrim(profile.last_name), ''), member.last_name),
          'displayName', profile.display_name,
          'emailConfirmed', candidate_auth.email_confirmed_at is not null,
          'matchReason', case
            when exists (
              select 1
              from public.tournament_team_players as player_email
              where player_email.external_identity_id = identity.id
                and player_email.tournament_id = target_tournament_id
                and nullif(btrim(player_email.email), '') is not null
                and lower(btrim(player_email.email)) = lower(btrim(profile.email))
            ) then 'email'
            else 'name'
          end,
          'matchRank', case
            when exists (
              select 1
              from public.tournament_team_players as player_email
              where player_email.external_identity_id = identity.id
                and player_email.tournament_id = target_tournament_id
                and nullif(btrim(player_email.email), '') is not null
                and lower(btrim(player_email.email)) = lower(btrim(profile.email))
            ) then '0'
            else '1'
          end
        ) as candidate
        from public.profiles as profile
        join auth.users as candidate_auth on candidate_auth.id = profile.id
        left join public.club_members as member
          on member.id = public.profile_club_member_id(profile.id, current_club)
        where identity.profile_id is null
          and (
            exists (
              select 1
              from public.tournament_team_players as player_email
              where player_email.external_identity_id = identity.id
                and player_email.tournament_id = target_tournament_id
                and nullif(btrim(player_email.email), '') is not null
                and lower(btrim(player_email.email)) = lower(btrim(profile.email))
            )
            or (
              public.normalize_member_identity(
                coalesce(nullif(btrim(profile.first_name), ''), member.first_name, '')
              ) = identity.first_name_normalized
              and public.normalize_member_identity(
                coalesce(nullif(btrim(profile.last_name), ''), member.last_name, '')
              ) = identity.last_name_normalized
            )
          )
        limit 10
      ) as candidate_rows
    ) as candidates
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_replace_tournament_player(target_team_id uuid, target_role text, replacement jsonb, replacement_reason text DEFAULT 'Blessure'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    where profile.id = public.club_member_profile_id(replacement_member_id)
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
    and public.club_member_profile_id(replacement_member_id) is distinct from replacement_profile_id then
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
      coalesce(replacement_member_id, public.profile_club_member_id(replacement_profile_id, target_tournament.club_id)),
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
      member_id = coalesce(replacement_member_id, public.profile_club_member_id(replacement_profile_id, target_tournament.club_id), identity.member_id),
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
        and public.club_member_profile_id(old_player.member_id) = profile.id
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

  perform public.sync_tournament_team_calendar_labels(target_team.id);

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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_search_tournament_account_candidates(target_external_identity_id uuid, search_term text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_club uuid := public.admin_current_club_id();
  target_identity public.tournament_external_player_identities%rowtype;
  query_text text := btrim(coalesce(search_term, ''));
begin
  if current_club is null
    or not public.has_club_permission(current_club, 'tournaments.manage')
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select identity.*
  into target_identity
  from public.tournament_external_player_identities as identity
  where identity.id = target_external_identity_id
    and exists (
      select 1
      from public.tournament_team_players as player
      join public.tournament_teams as team on team.id = player.team_id
      join public.tournaments as tournament on tournament.id = player.tournament_id
      where player.external_identity_id = identity.id
        and tournament.club_id = current_club
        and team.status in ('pending', 'accepted')
    );

  if target_identity.id is null then
    raise exception 'External participation not found' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', profile.id,
        'email', profile.email,
        'firstName', coalesce(nullif(btrim(profile.first_name), ''), member.first_name),
        'lastName', coalesce(nullif(btrim(profile.last_name), ''), member.last_name),
        'displayName', profile.display_name,
        'memberId', public.profile_club_member_id(profile.id, current_club),
        'emailConfirmed', candidate_auth.email_confirmed_at is not null,
        'exactName',
          public.normalize_member_identity(
            coalesce(nullif(btrim(profile.first_name), ''), member.first_name, '')
          ) = target_identity.first_name_normalized
          and public.normalize_member_identity(
            coalesce(nullif(btrim(profile.last_name), ''), member.last_name, '')
          ) = target_identity.last_name_normalized
      )
      order by
        case when
          public.normalize_member_identity(
            coalesce(nullif(btrim(profile.first_name), ''), member.first_name, '')
          ) = target_identity.first_name_normalized
          and public.normalize_member_identity(
            coalesce(nullif(btrim(profile.last_name), ''), member.last_name, '')
          ) = target_identity.last_name_normalized
        then 0 else 1 end,
        lower(coalesce(profile.last_name, member.last_name, profile.display_name, profile.email, ''))
    )
    from public.profiles as profile
    join auth.users as candidate_auth on candidate_auth.id = profile.id
    left join public.club_members as member
      on member.id = public.profile_club_member_id(profile.id, current_club)
    where (
      query_text = ''
      and public.normalize_member_identity(
        coalesce(nullif(btrim(profile.first_name), ''), member.first_name, '')
      ) = target_identity.first_name_normalized
      and public.normalize_member_identity(
        coalesce(nullif(btrim(profile.last_name), ''), member.last_name, '')
      ) = target_identity.last_name_normalized
    ) or (
      query_text <> ''
      and (
        coalesce(profile.first_name, '') ilike '%' || query_text || '%'
        or coalesce(profile.last_name, '') ilike '%' || query_text || '%'
        or coalesce(profile.display_name, '') ilike '%' || query_text || '%'
        or coalesce(profile.email, '') ilike '%' || query_text || '%'
        or coalesce(member.first_name, '') ilike '%' || query_text || '%'
        or coalesce(member.last_name, '') ilike '%' || query_text || '%'
      )
    )
    limit 25
  ), '[]'::jsonb);
end;
$function$
;

commit;
