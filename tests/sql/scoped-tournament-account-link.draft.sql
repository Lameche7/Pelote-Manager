-- Draft: only confirmed matching accounts, never mutate an unresolved identity shared across clubs.
CREATE OR REPLACE FUNCTION public.admin_link_tournament_account_for_club(target_club_id uuid, target_tournament_id uuid, target_external_identity_id uuid, target_profile_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := auth.uid();
  current_club uuid := target_club_id;
  target_identity public.tournament_external_player_identities%rowtype;
  target_profile public.profiles%rowtype;
  tournament_row record;
begin
  if actor_id is null
    or current_club is null
    or not coalesce((public.can_administer_club(current_club, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), current_club)), false)
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
    join public.tournament_teams as team on team.id = player.team_id and team.tournament_id = tournament.id
    where player.external_identity_id = target_identity.id
      and tournament.club_id = current_club
      and tournament.id = target_tournament_id
      and team.status in ('pending', 'accepted')
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

  -- A club administrator must not change an unresolved identity shared with another club.
  if exists (
    select 1 from public.tournament_team_players p
    join public.tournaments t on t.id = p.tournament_id
    where p.external_identity_id = target_identity.id and t.club_id <> current_club
  ) then
    raise exception 'Shared network identity requires player verification' using errcode = '42501';
  end if;

  -- Require the same participant evidence as candidate discovery, and a confirmed account.
  if not exists (select 1 from auth.users u where u.id = target_profile.id and u.email_confirmed_at is not null)
    or not (
      exists (
        select 1 from public.tournament_team_players p
        join public.tournament_teams t on t.id = p.team_id and t.tournament_id = target_tournament_id
        where p.tournament_id = target_tournament_id and p.external_identity_id = target_identity.id
          and t.status in ('pending', 'accepted') and nullif(btrim(p.email), '') is not null
          and lower(btrim(p.email)) = lower(btrim(target_profile.email))
      ) or (
        public.normalize_member_identity(coalesce(target_profile.first_name, '')) = target_identity.first_name_normalized
        and public.normalize_member_identity(coalesce(target_profile.last_name, '')) = target_identity.last_name_normalized
      )
    ) then
    raise exception 'Account does not match confirmed participant evidence' using errcode = '22023';
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
$function$;
revoke all on function public.admin_link_tournament_account_for_club(uuid, uuid, uuid, uuid) from public, anon, authenticated;
