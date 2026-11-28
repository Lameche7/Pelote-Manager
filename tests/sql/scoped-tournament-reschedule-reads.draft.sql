-- Club-scoped read operations; original RPCs remain unchanged.
CREATE OR REPLACE FUNCTION public.admin_get_tournament_manual_reschedule_context_for_club(target_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
begin
  if target_club_id is null
    or not (auth.uid() is not null and target_club_id is not null and (public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id))) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', tournament.id,
          'name', tournament.name,
          'status', tournament.status,
          'matches', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', match.id,
                'phase', match.phase,
                'team_a_id', match.team_a_id,
                'team_a_label', public.tournament_team_public_label(match.team_a_id),
                'team_b_id', match.team_b_id,
                'team_b_label', public.tournament_team_public_label(match.team_b_id),
                'resource_id', planning.resource_id,
                'resource_name', resource.name,
                'play_date', planning.play_date,
                'starts_at', planning.starts_at,
                'ends_at', planning.ends_at
              )
              order by planning.play_date, planning.starts_at,
                public.tournament_team_public_label(match.team_a_id)
            )
            from public.tournament_matches as match
            join public.tournament_match_planning as planning
              on planning.match_id = match.id
            join public.reservable_resources as resource
              on resource.id = planning.resource_id
            where match.tournament_id = tournament.id
              and resource.club_id = target_club_id
              and match.team_a_id is not null
              and match.team_b_id is not null
              and not exists (
                select 1
                from public.tournament_match_results as result
                where result.match_id = match.id
                  and result.status = 'validated'
              )
              and exists (
                select 1
                from public.tournament_match_events as link
                join public.events as event on event.id = link.event_id
                where link.match_id = match.id
                  and event.publication_status = 'published'
              )
              and not exists (
                select 1
                from public.tournament_reschedule_active_matches as active
                where active.match_id = match.id
              )
          ), '[]'::jsonb)
        )
        order by tournament.starts_on desc, tournament.name
      ),
      '[]'::jsonb
    )
    from public.tournaments as tournament
    where tournament.club_id = target_club_id
      and tournament.status in ('planning_published', 'in_progress')
  );
end;
$function$;
revoke all on function public.admin_get_tournament_manual_reschedule_context_for_club(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_tournament_manual_reschedule_context_for_club(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_tournament_reschedule_requests_for_club(target_club_id uuid, target_tournament_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if not (auth.uid() is not null and target_club_id is not null and (public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id))) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', request.id,
        'tournament_id', request.tournament_id,
        'tournament_name', tournament.name,
        'match_id', request.match_id,
        'requester_team_id', request.requester_team_id,
        'requester_label', public.tournament_team_public_label(request.requester_team_id),
        'proposal_kind', request.proposal_kind,
        'status', request.status,
        'proposal_snapshot', request.proposal_snapshot,
        'stale_reason', request.stale_reason,
        'applied_at', request.applied_at,
        'expires_at', request.expires_at,
        'created_at', request.created_at,
        'approvals', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'team_id', approval.team_id,
                'team_label', public.tournament_team_public_label(approval.team_id),
                'decision', approval.decision,
                'decision_source', approval.decision_source,
                'decision_note', approval.decision_note,
                'is_requester', approval.is_requester,
                'app_actor_count', public.tournament_team_app_actor_count(approval.team_id),
                'decided_at', approval.decided_at
              )
              order by approval.is_requester desc, public.tournament_team_public_label(approval.team_id)
            ),
            '[]'::jsonb
          )
          from public.tournament_reschedule_approvals as approval
          where approval.request_id = request.id
        )
      )
      order by
        case request.status when 'pending' then 0 when 'approved' then 1 else 2 end,
        request.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from public.tournament_reschedule_requests as request
  join public.tournaments as tournament on tournament.id = request.tournament_id
  where tournament.club_id = target_club_id
    and (target_tournament_id is null or request.tournament_id = target_tournament_id);

  return result;
end;
$function$;
revoke all on function public.admin_list_tournament_reschedule_requests_for_club(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_list_tournament_reschedule_requests_for_club(uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_tournament_reschedule_push_status_for_club(target_club_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with teams as (
  select distinct a.team_id
  from public.tournament_reschedule_approvals a
  join public.tournament_reschedule_requests r on r.id = a.request_id
  join public.tournaments t on t.id = r.tournament_id
  where r.status in ('pending', 'approved')
    and a.decision = 'pending'
    and t.club_id = target_club_id
    and (auth.uid() is not null and target_club_id is not null and (public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)))
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
  when target_club_id is null
    or not (auth.uid() is not null and target_club_id is not null and (public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)))
  then '[]'::jsonb
  else coalesce(jsonb_agg(jsonb_build_object(
    'team_id', team_id, 'linked_count', linked_count, 'push_count', push_count
  )), '[]'::jsonb)
end
from summary;
$function$;
revoke all on function public.admin_tournament_reschedule_push_status_for_club(uuid) from public, anon, authenticated;
grant execute on function public.admin_tournament_reschedule_push_status_for_club(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_unprogrammed_tournament_match_contacts_for_club(target_club_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'match_id', q.match_id,
    'team_id', p.team_id,
    'name', concat_ws(' ',nullif(btrim(p.first_name),''),nullif(btrim(p.last_name),'')),
    'phone', coalesce(
      nullif(btrim(cm.phone),''),
      case when ext.status='verified' then coalesce(
        nullif(btrim(ext_member.phone),''),
        nullif(btrim(profile_member.phone),'')
      ) end,
      nullif(btrim(p.phone),'')
    )
  ) order by q.match_id,p.team_id,p.last_name,p.first_name),'[]'::jsonb)
  from public.tournament_unprogrammed_matches q
  join public.tournaments t on t.id=q.tournament_id
  join public.tournament_matches m on m.id=q.match_id
  join public.tournament_team_players p on p.team_id in (m.team_a_id,m.team_b_id)
  left join public.club_members cm on cm.id=p.member_id
  left join public.tournament_external_player_identities ext on ext.id=p.external_identity_id
  left join public.club_members ext_member on ext_member.id=ext.member_id
  left join public.profiles profile on profile.id=ext.profile_id
  left join public.club_members profile_member on profile_member.id=profile.member_id
  where auth.uid() is not null
    and t.club_id=target_club_id
    and (auth.uid() is not null and target_club_id is not null and (public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)));
$function$;
revoke all on function public.admin_unprogrammed_tournament_match_contacts_for_club(uuid) from public, anon, authenticated;
grant execute on function public.admin_unprogrammed_tournament_match_contacts_for_club(uuid) to authenticated;

