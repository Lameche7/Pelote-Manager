begin;

-- PILOTOKI Network: tournament player access must resolve the local member row
-- in the tournament's club instead of assuming profiles.member_id is universal.
create or replace function public.tournament_profile_is_linked_to_team(
  target_team_id uuid,
  target_profile_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select profile.id, profile.email
    from public.profiles as profile
    where profile.id = target_profile_id
  )
  select exists (
    select 1
    from public.tournament_teams as team
    join public.tournaments as tournament on tournament.id = team.tournament_id
    cross join actor
    where team.id = target_team_id
      and team.status in ('pending', 'accepted')
      and (
        team.submitted_by = actor.id
        or exists (
          select 1
          from public.tournament_team_players as player
          left join public.tournament_external_player_identities as identity
            on identity.id = player.external_identity_id
          where player.team_id = team.id
            and (
              (
                player.member_id is not null
                and player.member_id = public.profile_club_member_id(
                  actor.id,
                  tournament.club_id
                )
              )
              or (
                identity.status = 'verified'
                and identity.profile_id = actor.id
              )
              or (
                player.external_identity_id is null
                and nullif(btrim(actor.email), '') is not null
                and nullif(btrim(player.email), '') is not null
                and lower(btrim(player.email)) = lower(btrim(actor.email))
              )
            )
        )
      )
  );
$$;

revoke all on function public.tournament_profile_is_linked_to_team(uuid, uuid)
from public, anon, authenticated;

comment on function public.tournament_profile_is_linked_to_team(uuid, uuid) is
  'Détermine si un compte représente une équipe via le déposant, son adhésion locale PILOTOKI Network, une identité externe vérifiée ou le repli e-mail historique.';

-- Keep the optimized set-based count while resolving a player's local member
-- through the shared global sport identity. This avoids an N-profiles RPC loop.
create or replace function public.tournament_team_app_actor_count(
  target_team_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with team as (
    select item.id, item.submitted_by, tournament.club_id
    from public.tournament_teams as item
    join public.tournaments as tournament on tournament.id = item.tournament_id
    where item.id = target_team_id
      and item.status = 'accepted'
  ),
  candidate_profiles as (
    select profile.id
    from team
    join public.profiles as profile
      on profile.id = team.submitted_by

    union

    select profile.id
    from team
    join public.tournament_team_players as player
      on player.team_id = team.id
    join public.club_members as member
      on member.id = player.member_id
     and member.club_id = team.club_id
     and member.is_active
    join public.profiles as profile
      on (
        profile.sport_player_id is not null
        and profile.sport_player_id = member.sport_player_id
      )
      or profile.member_id = member.id
    where player.member_id is not null

    union

    select profile.id
    from team
    join public.tournament_team_players as player
      on player.team_id = team.id
    join public.tournament_external_player_identities as identity
      on identity.id = player.external_identity_id
     and identity.status = 'verified'
    join public.profiles as profile
      on profile.id = identity.profile_id

    union

    select profile.id
    from team
    join public.tournament_team_players as player
      on player.team_id = team.id
    join public.profiles as profile
      on player.external_identity_id is null
     and nullif(btrim(player.email), '') is not null
     and nullif(btrim(profile.email), '') is not null
     and lower(btrim(profile.email)) = lower(btrim(player.email))
  )
  select count(*)::integer
  from candidate_profiles;
$$;

revoke all on function public.tournament_team_app_actor_count(uuid)
from public, anon, authenticated;

commit;
