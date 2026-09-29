begin;

-- PILOTOKI Network: a claimed tournament identity must attach to the local
-- membership of the tournament's club, not blindly to profiles.member_id.
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
  target_club_id uuid;
  target_member_id uuid;
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

  select min(tournament.club_id)
  into target_club_id
  from public.tournament_team_players as player
  join public.tournaments as tournament on tournament.id = player.tournament_id
  where player.external_identity_id = target_identity.id
  having count(distinct tournament.club_id) = 1;

  if target_club_id is null then
    raise exception 'External participation club is ambiguous'
      using errcode = 'P0001';
  end if;

  target_member_id := public.profile_club_member_id(
    current_profile.id,
    target_club_id
  );

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
          target_member_id is not null
          and other_player.member_id = target_member_id
        )
      )
  ) then
    raise exception 'Account already represents another player in this tournament series'
      using errcode = '23505';
  end if;

  update public.tournament_external_player_identities as identity
  set
    profile_id = current_profile.id,
    member_id = coalesce(identity.member_id, target_member_id),
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

-- A profile and a local member are consistent when they resolve to the same
-- global sport identity. Legacy profiles without sport_player_id keep the
-- historical member_id equality fallback.
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
  if new.status <> 'verified' or (new.profile_id is null and new.member_id is null) then
    return new;
  end if;

  if new.profile_id is not null then
    select profile.*
    into target_profile
    from public.profiles as profile
    where profile.id = new.profile_id;
    if target_profile.id is null then return new; end if;
  end if;

  if new.member_id is not null then
    select member.*
    into target_member
    from public.club_members as member
    where member.id = new.member_id
      and member.is_active;
    if target_member.id is null then return new; end if;

    select club.name
    into target_club_name
    from public.clubs as club
    where club.id = target_member.club_id;
  end if;

  if target_profile.id is not null
    and target_member.id is not null
    and not (
      (
        target_profile.sport_player_id is not null
        and target_member.sport_player_id = target_profile.sport_player_id
      )
      or (
        target_profile.sport_player_id is null
        and target_profile.member_id = target_member.id
      )
    ) then
    raise exception 'External identity profile/member link is inconsistent'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.tournament_team_players as affected_player
    join public.tournament_teams as affected_team
      on affected_team.id = affected_player.team_id
     and affected_team.tournament_id = affected_player.tournament_id
    where affected_player.external_identity_id = new.id
    group by affected_player.tournament_id, affected_team.series_id
    having count(*) > 1
  ) then
    raise exception 'External identity appears more than once in the same tournament series'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.tournament_team_players as affected_player
    join public.tournament_teams as affected_team
      on affected_team.id = affected_player.team_id
     and affected_team.tournament_id = affected_player.tournament_id
    join public.tournament_team_players as other_player
      on other_player.tournament_id = affected_player.tournament_id
     and other_player.id <> affected_player.id
    join public.tournament_teams as other_team
      on other_team.id = other_player.team_id
     and other_team.tournament_id = affected_team.tournament_id
     and other_team.series_id = affected_team.series_id
     and other_team.status in ('pending', 'accepted')
    left join public.tournament_external_player_identities as other_identity
      on other_identity.id = other_player.external_identity_id
    where affected_player.external_identity_id = new.id
      and (
        (target_member.id is not null and other_player.member_id = target_member.id)
        or (
          target_profile.id is not null
          and other_identity.status = 'verified'
          and other_identity.profile_id = target_profile.id
        )
      )
  ) then
    raise exception 'Account already represents another player in this tournament series'
      using errcode = '23505';
  end if;

  update public.tournament_team_players as player
  set
    member_id = case when target_member.id is not null then target_member.id else player.member_id end,
    first_name = case when target_member.id is not null then target_member.first_name else new.first_name end,
    last_name = case when target_member.id is not null then target_member.last_name else new.last_name end,
    club_name = case
      when target_member.id is not null
        then coalesce(nullif(target_club_name, ''), player.club_name)
      else player.club_name
    end,
    email = case when target_profile.id is not null then target_profile.email else player.email end
  where player.external_identity_id = new.id;

  return new;
end;
$$;

revoke all on function public.sync_verified_external_identity_to_tournament_players()
from public, anon, authenticated;

commit;
