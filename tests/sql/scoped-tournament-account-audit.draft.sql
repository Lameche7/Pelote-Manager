-- Draft: read-only audit for an explicitly authorized club and tournament.
-- Candidate discovery remains tied to the selected tournament's registered names or email.
CREATE OR REPLACE FUNCTION public.admin_list_tournament_account_audit_for_club(target_club_id uuid, target_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_club uuid := target_club_id;
begin
  if auth.uid() is null or current_club is null
    or not coalesce((public.can_administer_club(current_club, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), current_club)), false)
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
$function$;
revoke all on function public.admin_list_tournament_account_audit_for_club(uuid, uuid) from public, anon, authenticated;
