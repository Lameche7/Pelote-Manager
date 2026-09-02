begin;

-- PR127 — expose uniquement l'état de joignabilité dans Pelote Manager des
-- équipes concernées par un report. L'absence de compte ne bloque jamais la
-- création d'une demande : elle signale simplement qu'un accord devra être
-- recueilli hors application par l'organisation.
create or replace function public.get_my_tournament_reschedule_contact_state(
  target_match_id uuid,
  requester_team_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_match public.tournament_matches%rowtype;
  opponent_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = target_match_id;

  if target_match.id is null then
    raise exception 'Tournament match not found' using errcode = 'P0002';
  end if;

  if requester_team_id not in (target_match.team_a_id, target_match.team_b_id)
    or not public.tournament_profile_can_act_for_team(requester_team_id, auth.uid()) then
    raise exception 'Tournament team cannot request this reschedule'
      using errcode = '42501';
  end if;

  opponent_team_id := case
    when target_match.team_a_id = requester_team_id then target_match.team_b_id
    else target_match.team_a_id
  end;

  return jsonb_build_object(
    'opponent_team_id', opponent_team_id,
    'opponent_label', public.tournament_team_public_label(opponent_team_id),
    'opponent_app_actor_count', public.tournament_team_app_actor_count(opponent_team_id),
    'requires_offline_opponent_contact',
      public.tournament_team_app_actor_count(opponent_team_id) = 0
  );
end;
$$;

revoke all on function public.get_my_tournament_reschedule_contact_state(uuid, uuid)
from public, anon;
grant execute on function public.get_my_tournament_reschedule_contact_state(uuid, uuid)
to authenticated;

commit;
