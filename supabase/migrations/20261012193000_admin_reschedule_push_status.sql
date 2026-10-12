begin;

-- Read-only admin status for push subscriptions on teams awaiting reschedule approval.
-- Uses the same identity resolution paths as tournament_team_app_actor_count.
create or replace function public.admin_tournament_reschedule_push_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
with teams as (
  select distinct a.team_id
  from public.tournament_reschedule_approvals a
  join public.tournament_reschedule_requests r on r.id = a.request_id
  join public.tournaments t on t.id = r.tournament_id
  where r.status in ('pending', 'approved')
    and a.decision = 'pending'
    and t.club_id = public.admin_current_club_id()
    and public.has_club_permission(t.club_id, 'tournaments.manage')
),
candidates as (
  select teams.team_id, profile.id as profile_id
  from teams
  join public.tournament_teams tt on tt.id = teams.team_id
  join public.profiles profile on profile.id = tt.submitted_by
  union
  select teams.team_id, profile.id
  from teams
  join public.tournament_team_players player on player.team_id = teams.team_id
  join public.profiles profile on profile.member_id = player.member_id
  union
  select teams.team_id, profile.id
  from teams
  join public.tournament_team_players player on player.team_id = teams.team_id
  join public.tournament_external_player_identities identity
    on identity.id = player.external_identity_id and identity.status = 'verified'
  join public.profiles profile on profile.id = identity.profile_id
  union
  select teams.team_id, profile.id
  from teams
  join public.tournament_team_players player on player.team_id = teams.team_id
  join public.profiles profile on player.external_identity_id is null
    and nullif(btrim(player.email), '') is not null
    and nullif(btrim(profile.email), '') is not null
    and lower(btrim(profile.email)) = lower(btrim(player.email))
),
summary as (
  select teams.team_id,
    count(distinct candidates.profile_id)::int as linked_count,
    count(distinct candidates.profile_id) filter (
      where exists (
        select 1 from public.push_subscriptions ps
        where ps.profile_id = candidates.profile_id and ps.is_active
      )
    )::int as push_count
  from teams
  left join candidates on candidates.team_id = teams.team_id
  group by teams.team_id
)
select case
  when public.admin_current_club_id() is null
    or not public.has_club_permission(public.admin_current_club_id(), 'tournaments.manage')
  then '[]'::jsonb
  else coalesce(jsonb_agg(jsonb_build_object(
    'team_id', team_id, 'linked_count', linked_count, 'push_count', push_count
  )), '[]'::jsonb)
end
from summary;
$function$;

revoke all on function public.admin_tournament_reschedule_push_status() from public, anon;
grant execute on function public.admin_tournament_reschedule_push_status() to authenticated;
commit;
