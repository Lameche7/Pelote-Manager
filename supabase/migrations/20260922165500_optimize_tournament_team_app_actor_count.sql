begin;

-- PR236 — accélère le chargement des reports admin.
--
-- tournament_team_app_actor_count() parcourait tous les profils puis appelait
-- tournament_profile_can_act_for_team() pour chacun d'eux. Sur la liste des
-- reports, cette fonction était appelée pour chaque équipe/approbation et le
-- RPC admin_list_tournament_reschedule_requests dépassait régulièrement 8 s.
--
-- Cette version calcule exactement les mêmes profils autorisés de façon
-- ensembliste : auteur de l'équipe, membre relié, identité externe vérifiée
-- et correspondance d'e-mail lorsque l'identité externe est absente.

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
    select item.id, item.submitted_by
    from public.tournament_teams as item
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
    join public.profiles as profile
      on profile.member_id is not null
     and profile.member_id = player.member_id
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
