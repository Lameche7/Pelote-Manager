begin;
-- Report exceptionnel administrateur, sans ouvrir la grille du tournoi.
create or replace function public.admin_create_tournament_exceptional_reschedule_request(
  target_match_id uuid,
  requester_team_id uuid,
  target_resource_id uuid,
  target_play_date date,
  target_starts_at time,
  target_ends_at time,
  contact_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_match public.tournament_matches%rowtype;
  target_tournament public.tournaments%rowtype;
  target_planning public.tournament_match_planning%rowtype;
  original_resource public.reservable_resources%rowtype;
  candidate jsonb;
  request_id uuid;
  opponent_team_id uuid;
  requester_label text;
  opponent_label text;
  expires_at timestamptz;
  normalized_note text := nullif(btrim(contact_note), '');
begin
  if target_club_id is null
    or not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if normalized_note is null or char_length(normalized_note) not between 3 and 500 then
    raise exception 'Tournament reschedule offline contact note is required'
      using errcode = '22023';
  end if;

  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = target_match_id;

  if target_match.id is null then
    raise exception 'Tournament match not found' using errcode = 'P0002';
  end if;

  if requester_team_id not in (target_match.team_a_id, target_match.team_b_id) then
    raise exception 'Tournament reschedule requester team is invalid'
      using errcode = '22023';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_match.tournament_id
    and tournament.club_id = target_club_id;

  if target_tournament.id is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select planning.*
  into target_planning
  from public.tournament_match_planning as planning
  where planning.match_id = target_match.id;

  if target_planning.match_id is null then
    raise exception 'Tournament match is not scheduled' using errcode = 'P0001';
  end if;

  select resource.*
  into original_resource
  from public.reservable_resources as resource
  where resource.id = target_planning.resource_id;

  if original_resource.id is null then
    raise exception 'Tournament match resource is invalid' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.tournament_match_events as link
    join public.events as event on event.id = link.event_id
    where link.match_id = target_match.id
      and event.publication_status = 'published'
  ) then
    raise exception 'Tournament match is not published' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.tournament_match_results as result
    where result.match_id = target_match.id
  ) then
    raise exception 'Tournament match already has a result' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.tournament_reschedule_active_matches as active
    where active.match_id = target_match.id
  ) then
    raise exception 'Tournament match already has an active reschedule request'
      using errcode = '23505';
  end if;


  -- Le mode exceptionnel est réservé à l'administrateur. Il ne modifie
  -- ni la grille hebdomadaire ni les créneaux proposés aux joueurs.
  if target_ends_at <= target_starts_at then
    raise exception 'Exceptional reschedule end must be after start' using errcode='22023';
  end if;
  if target_play_date < current_date then
    raise exception 'Exceptional reschedule must be in the future' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.tournament_resources tr
    join public.reservable_resources r on r.id=tr.resource_id
    where tr.tournament_id=target_tournament.id
      and tr.resource_id=target_resource_id and r.is_active
  ) then
    raise exception 'Exceptional reschedule resource is not authorized' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.reservable_resources r
    where r.id=target_resource_id
      and public.tournament_planning_starts_at(target_play_date,target_starts_at,r.timezone)>now()
  ) then
    raise exception 'Exceptional reschedule must be in the future' using errcode='22023';
  end if;
  if exists (
    select 1 from public.calendar_occupations o
    join public.reservable_resources r on r.id=o.resource_id
    where o.resource_id=target_resource_id and o.cancelled_at is null
      and o.starts_at < public.tournament_planning_starts_at(target_play_date,target_ends_at,r.timezone)
      and o.ends_at > public.tournament_planning_starts_at(target_play_date,target_starts_at,r.timezone)
      and not exists (
        select 1 from public.tournament_match_events l
        join public.event_resources er on er.event_id=l.event_id
        where l.match_id=target_match.id and er.calendar_occupation_id=o.id
      )
  ) then
    raise exception 'Exceptional reschedule slot occupied' using errcode='P0001';
  end if;
  if exists (
    select 1 from public.tournament_match_planning p
    join public.tournament_matches m on m.id=p.match_id
    where m.tournament_id=target_tournament.id and m.id<>target_match.id
      and p.play_date=target_play_date
      and p.starts_at<target_ends_at and p.ends_at>target_starts_at
      and (p.resource_id=target_resource_id
        or target_match.team_a_id in (m.team_a_id,m.team_b_id)
        or target_match.team_b_id in (m.team_a_id,m.team_b_id))
  ) then
    raise exception 'Exceptional reschedule match conflict' using errcode='P0001';
  end if;
  candidate:=jsonb_build_object(
    'resource_id',target_resource_id,'resource_name',
      (select r.name from public.reservable_resources r where r.id=target_resource_id),
    'play_date',target_play_date,'starts_at',target_starts_at,'ends_at',target_ends_at
  );

  opponent_team_id := case
    when target_match.team_a_id = requester_team_id then target_match.team_b_id
    else target_match.team_a_id
  end;
  requester_label := public.tournament_team_public_label(requester_team_id);
  opponent_label := public.tournament_team_public_label(opponent_team_id);

  expires_at := public.tournament_planning_starts_at(
    target_planning.play_date,
    target_planning.starts_at,
    original_resource.timezone
  );

  if expires_at <= now() then
    raise exception 'Tournament match has already started' using errcode = 'P0001';
  end if;

  insert into public.tournament_reschedule_requests (
    tournament_id,
    match_id,
    requester_team_id,
    requested_by,
    proposal_kind,
    target_resource_id,
    target_play_date,
    target_starts_at,
    target_ends_at,
    proposal_snapshot,
    expires_at
  ) values (
    target_tournament.id,
    target_match.id,
    requester_team_id,
    auth.uid(),
    'free_slot',
    (candidate->>'resource_id')::uuid,
    (candidate->>'play_date')::date,
    (candidate->>'starts_at')::time,
    (candidate->>'ends_at')::time,
    jsonb_build_object(
      'match', jsonb_build_object(
        'id', target_match.id,
        'phase', target_match.phase,
        'requester_team_id', requester_team_id,
        'requester_label', requester_label,
        'opponent_team_id', opponent_team_id,
        'opponent_label', opponent_label,
        'resource_id', target_planning.resource_id,
        'resource_name', original_resource.name,
        'play_date', target_planning.play_date,
        'starts_at', target_planning.starts_at,
        'ends_at', target_planning.ends_at
      ),
      'policy', jsonb_build_object(
        'admin_manual', true,
        'requester_contact_note', normalized_note,
        'admin_exceptional', true
      ),
      'proposal', candidate || jsonb_build_object(
        'kind', 'free_slot',
        'preference', 'admin_exceptional'
      )
    ),
    expires_at
  ) returning id into request_id;

  insert into public.tournament_reschedule_approvals (
    request_id,
    team_id,
    decision,
    is_requester,
    decided_by,
    decided_at,
    decision_source,
    decision_note
  ) values (
    request_id,
    requester_team_id,
    'approved',
    true,
    auth.uid(),
    now(),
    'offline_admin',
    normalized_note
  );

  insert into public.tournament_reschedule_approvals (
    request_id,
    team_id,
    decision,
    is_requester
  ) values (
    request_id,
    opponent_team_id,
    'pending',
    false
  );

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    payload,
    created_by
  ) values (
    target_tournament.id,
    'reschedule_requested',
    jsonb_build_object(
      'request_id', request_id,
      'match_id', target_match.id,
      'requester_team_id', requester_team_id,
      'proposal_kind', 'free_slot',
      'source', 'admin_exceptional',
      'proposal', candidate,
      'contact_note', normalized_note
    ),
    auth.uid()
  );

  return request_id;
end;
$$;


revoke all on function public.admin_create_tournament_exceptional_reschedule_request(uuid,uuid,uuid,date,time,time,text) from public,anon,authenticated;
grant execute on function public.admin_create_tournament_exceptional_reschedule_request(uuid,uuid,uuid,date,time,time,text) to authenticated;
CREATE OR REPLACE FUNCTION public.admin_apply_tournament_reschedule_request(target_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_club_id uuid;
  caller_can_apply boolean := false;
  request public.tournament_reschedule_requests%rowtype;
  tournament public.tournaments%rowtype;
  target_match public.tournament_matches%rowtype;
  swap_match public.tournament_matches%rowtype;
  target_plan public.tournament_match_planning%rowtype;
  swap_plan public.tournament_match_planning%rowtype;
  target_resource public.reservable_resources%rowtype;
  return_resource public.reservable_resources%rowtype;
  match_snapshot jsonb;
  proposal_snapshot jsonb;
  opponent_team_id uuid;
  swap_team_a_id uuid;
  swap_team_b_id uuid;
  target_event_id uuid;
  swap_event_id uuid;
  opponent_original_other integer;
  opponent_target_other integer;
  swap_a_original_other integer;
  swap_a_target_other integer;
  swap_b_original_other integer;
  swap_b_target_other integer;
  before_snapshot jsonb;
  after_snapshot jsonb;
  target_node_exists boolean := false;
  swap_node_exists boolean := false;
  mutation_conflict boolean := false;
  manual_agreement_override boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select item.*
  into request
  from public.tournament_reschedule_requests as item
  where item.id = target_request_id
  for update;

  if request.id is null then
    raise exception 'Tournament reschedule request not found' using errcode = 'P0002';
  end if;

  select item.*
  into tournament
  from public.tournaments as item
  where item.id = request.tournament_id
  for update;

  if tournament.id is null then
    raise exception 'Tournament reschedule tournament not found'
      using errcode = 'P0002';
  end if;

  target_club_id := tournament.club_id;
  caller_can_apply := public.has_club_permission(target_club_id, 'tournaments.manage')
    or exists (
      select 1
      from public.tournament_reschedule_approvals as approval
      where approval.request_id = request.id
        and public.tournament_profile_can_act_for_team(approval.team_id, auth.uid())
    );

  if not caller_can_apply then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if request.status <> 'approved' then
    raise exception 'Tournament reschedule request is not ready to apply'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.tournament_reschedule_approvals as approval
    where approval.request_id = request.id
      and approval.decision <> 'approved'
  ) then
    raise exception 'Tournament reschedule request still misses an approval'
      using errcode = 'P0001';
  end if;

  manual_agreement_override :=
    coalesce((request.proposal_snapshot#>>'{policy,admin_manual}')::boolean, false)
    and exists (
      select 1 from public.tournament_reschedule_approvals as approval
      where approval.request_id = request.id
        and approval.decision = 'approved'
        and approval.decision_source = 'offline_admin'
    );

  if request.expires_at <= now() then
    perform public.mark_tournament_reschedule_stale(request.id, 'request_expired');
    return jsonb_build_object('status', 'stale', 'reason', 'request_expired');
  end if;

  if tournament.status not in ('planning_published', 'in_progress') then
    perform public.mark_tournament_reschedule_stale(request.id, 'tournament_stage_changed');
    return jsonb_build_object('status', 'stale', 'reason', 'tournament_stage_changed');
  end if;

  perform 1
  from public.tournament_matches as match
  where match.id in (request.match_id, request.swap_match_id)
  order by match.id
  for update;

  if exists (
    select 1
    from public.tournament_reschedule_active_matches as active
    where active.match_id in (request.match_id, request.swap_match_id)
      and active.request_id <> request.id
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'another_reschedule_started');
    return jsonb_build_object('status', 'stale', 'reason', 'another_reschedule_started');
  end if;

  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = request.match_id
    and match.tournament_id = request.tournament_id;

  if target_match.id is null
    or request.requester_team_id not in (target_match.team_a_id, target_match.team_b_id) then
    perform public.mark_tournament_reschedule_stale(request.id, 'match_changed');
    return jsonb_build_object('status', 'stale', 'reason', 'match_changed');
  end if;

  opponent_team_id := case
    when target_match.team_a_id = request.requester_team_id then target_match.team_b_id
    else target_match.team_a_id
  end;

  if exists (
    select 1 from public.tournament_match_results as result
    where result.match_id = target_match.id
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'match_has_result');
    return jsonb_build_object('status', 'stale', 'reason', 'match_has_result');
  end if;

  select planning.*
  into target_plan
  from public.tournament_match_planning as planning
  where planning.match_id = target_match.id
  for update;

  match_snapshot := coalesce(request.proposal_snapshot->'match', '{}'::jsonb);
  proposal_snapshot := coalesce(request.proposal_snapshot->'proposal', '{}'::jsonb);

  if target_plan.match_id is null
    or target_plan.resource_id is distinct from nullif(match_snapshot->>'resource_id', '')::uuid
    or target_plan.play_date is distinct from nullif(match_snapshot->>'play_date', '')::date
    or target_plan.starts_at is distinct from nullif(match_snapshot->>'starts_at', '')::time
    or target_plan.ends_at is distinct from nullif(match_snapshot->>'ends_at', '')::time then
    perform public.mark_tournament_reschedule_stale(request.id, 'source_planning_changed');
    return jsonb_build_object('status', 'stale', 'reason', 'source_planning_changed');
  end if;

  if request.proposal_kind = 'swap' then
    select match.*
    into swap_match
    from public.tournament_matches as match
    where match.id = request.swap_match_id
      and match.tournament_id = request.tournament_id
      and match.phase = target_match.phase;

    if swap_match.id is null then
      perform public.mark_tournament_reschedule_stale(request.id, 'swap_match_changed');
      return jsonb_build_object('status', 'stale', 'reason', 'swap_match_changed');
    end if;

    swap_team_a_id := swap_match.team_a_id;
    swap_team_b_id := swap_match.team_b_id;

    if exists (
      select 1 from public.tournament_match_results as result
      where result.match_id = swap_match.id
    ) then
      perform public.mark_tournament_reschedule_stale(request.id, 'swap_match_has_result');
      return jsonb_build_object('status', 'stale', 'reason', 'swap_match_has_result');
    end if;

    select planning.*
    into swap_plan
    from public.tournament_match_planning as planning
    where planning.match_id = swap_match.id
    for update;

    if swap_plan.match_id is null
      or swap_plan.resource_id is distinct from nullif(proposal_snapshot->>'resource_id', '')::uuid
      or swap_plan.play_date is distinct from nullif(proposal_snapshot->>'play_date', '')::date
      or swap_plan.starts_at is distinct from nullif(proposal_snapshot->>'starts_at', '')::time
      or swap_plan.ends_at is distinct from nullif(proposal_snapshot->>'ends_at', '')::time
      or request.swap_return_resource_id is distinct from target_plan.resource_id
      or request.swap_return_play_date is distinct from target_plan.play_date
      or request.swap_return_starts_at is distinct from target_plan.starts_at
      or request.swap_return_ends_at is distinct from target_plan.ends_at then
      perform public.mark_tournament_reschedule_stale(request.id, 'swap_planning_changed');
      return jsonb_build_object('status', 'stale', 'reason', 'swap_planning_changed');
    end if;
  end if;

  select link.event_id
  into target_event_id
  from public.tournament_match_events as link
  join public.events as event on event.id = link.event_id
  where link.match_id = target_match.id
    and event.publication_status = 'published';

  if target_event_id is null then
    perform public.mark_tournament_reschedule_stale(request.id, 'match_unpublished');
    return jsonb_build_object('status', 'stale', 'reason', 'match_unpublished');
  end if;

  if request.proposal_kind = 'swap' then
    select link.event_id
    into swap_event_id
    from public.tournament_match_events as link
    join public.events as event on event.id = link.event_id
    where link.match_id = swap_match.id
      and event.publication_status = 'published';

    if swap_event_id is null then
      perform public.mark_tournament_reschedule_stale(request.id, 'swap_match_unpublished');
      return jsonb_build_object('status', 'stale', 'reason', 'swap_match_unpublished');
    end if;
  end if;

  perform 1
  from public.reservable_resources as resource
  where resource.id in (
    target_plan.resource_id,
    request.target_resource_id,
    request.swap_return_resource_id
  )
  order by resource.id
  for update;

  select resource.*
  into target_resource
  from public.reservable_resources as resource
  where resource.id = request.target_resource_id
    and resource.is_active
    and exists (
      select 1 from public.tournament_resources as selected
      where selected.tournament_id = request.tournament_id
        and selected.resource_id = resource.id
    );

  if target_resource.id is null
    or (coalesce(request.proposal_snapshot->'policy'->>'admin_exceptional','false') <> 'true'
      and not exists (
      select 1
      from public.tournament_generated_slots(request.tournament_id) as slot
      where slot.phase = target_match.phase
        and slot.play_date = request.target_play_date
        and slot.starts_at = request.target_starts_at
        and slot.ends_at = request.target_ends_at
      )) then
    perform public.mark_tournament_reschedule_stale(request.id, 'target_slot_invalid');
    return jsonb_build_object('status', 'stale', 'reason', 'target_slot_invalid');
  end if;

  if public.tournament_planning_starts_at(
    request.target_play_date,
    request.target_starts_at,
    target_resource.timezone
  ) <= now() then
    perform public.mark_tournament_reschedule_stale(request.id, 'target_slot_started');
    return jsonb_build_object('status', 'stale', 'reason', 'target_slot_started');
  end if;

  if request.proposal_kind = 'swap' then
    select resource.*
    into return_resource
    from public.reservable_resources as resource
    where resource.id = request.swap_return_resource_id
      and resource.is_active
      and exists (
        select 1 from public.tournament_resources as selected
        where selected.tournament_id = request.tournament_id
          and selected.resource_id = resource.id
      );

    if return_resource.id is null then
      perform public.mark_tournament_reschedule_stale(request.id, 'swap_return_slot_invalid');
      return jsonb_build_object('status', 'stale', 'reason', 'swap_return_slot_invalid');
    end if;
  end if;

  if exists (
    select 1
    from public.tournament_match_planning as planning
    where planning.tournament_id = request.tournament_id
      and planning.match_id <> request.match_id
      and (request.swap_match_id is null or planning.match_id <> request.swap_match_id)
      and planning.resource_id = request.target_resource_id
      and planning.play_date = request.target_play_date
      and planning.starts_at < request.target_ends_at
      and planning.ends_at > request.target_starts_at
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'target_slot_conflict');
    return jsonb_build_object('status', 'stale', 'reason', 'target_slot_conflict');
  end if;

  if request.proposal_kind = 'swap' and exists (
    select 1
    from public.tournament_match_planning as planning
    where planning.tournament_id = request.tournament_id
      and planning.match_id not in (request.match_id, request.swap_match_id)
      and planning.resource_id = request.swap_return_resource_id
      and planning.play_date = request.swap_return_play_date
      and planning.starts_at < request.swap_return_ends_at
      and planning.ends_at > request.swap_return_starts_at
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'swap_return_slot_conflict');
    return jsonb_build_object('status', 'stale', 'reason', 'swap_return_slot_conflict');
  end if;

  if exists (
    select 1
    from public.calendar_occupations as occupation
    where occupation.resource_id = request.target_resource_id
      and occupation.cancelled_at is null
      and occupation.starts_at < public.tournament_planning_starts_at(
        request.target_play_date, request.target_ends_at, target_resource.timezone
      )
      and occupation.ends_at > public.tournament_planning_starts_at(
        request.target_play_date, request.target_starts_at, target_resource.timezone
      )
      and occupation.id not in (
        select event_resource.calendar_occupation_id
        from public.tournament_match_events as link
        join public.event_resources as event_resource on event_resource.event_id = link.event_id
        where link.match_id in (request.match_id, request.swap_match_id)
          and event_resource.calendar_occupation_id is not null
      )
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'calendar_conflict');
    return jsonb_build_object('status', 'stale', 'reason', 'calendar_conflict');
  end if;

  if request.proposal_kind = 'swap' and exists (
    select 1
    from public.calendar_occupations as occupation
    where occupation.resource_id = request.swap_return_resource_id
      and occupation.cancelled_at is null
      and occupation.starts_at < public.tournament_planning_starts_at(
        request.swap_return_play_date, request.swap_return_ends_at, return_resource.timezone
      )
      and occupation.ends_at > public.tournament_planning_starts_at(
        request.swap_return_play_date, request.swap_return_starts_at, return_resource.timezone
      )
      and occupation.id not in (
        select event_resource.calendar_occupation_id
        from public.tournament_match_events as link
        join public.event_resources as event_resource on event_resource.event_id = link.event_id
        where link.match_id in (request.match_id, request.swap_match_id)
          and event_resource.calendar_occupation_id is not null
      )
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'calendar_conflict');
    return jsonb_build_object('status', 'stale', 'reason', 'calendar_conflict');
  end if;

  if exists (
    select 1
    from public.tournament_matches as other_match
    join public.tournament_match_planning as planning on planning.match_id = other_match.id
    where other_match.tournament_id = request.tournament_id
      and other_match.id <> request.match_id
      and (request.swap_match_id is null or other_match.id <> request.swap_match_id)
      and (
        request.requester_team_id in (other_match.team_a_id, other_match.team_b_id)
        or opponent_team_id in (other_match.team_a_id, other_match.team_b_id)
      )
      and planning.play_date = request.target_play_date
      and planning.starts_at < request.target_ends_at
      and planning.ends_at > request.target_starts_at
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'team_overlap');
    return jsonb_build_object('status', 'stale', 'reason', 'team_overlap');
  end if;

  if request.proposal_kind = 'swap' and exists (
    select 1
    from public.tournament_matches as other_match
    join public.tournament_match_planning as planning on planning.match_id = other_match.id
    where other_match.tournament_id = request.tournament_id
      and other_match.id not in (request.match_id, request.swap_match_id)
      and (
        swap_team_a_id in (other_match.team_a_id, other_match.team_b_id)
        or swap_team_b_id in (other_match.team_a_id, other_match.team_b_id)
      )
      and planning.play_date = request.swap_return_play_date
      and planning.starts_at < request.swap_return_ends_at
      and planning.ends_at > request.swap_return_starts_at
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'team_overlap');
    return jsonb_build_object('status', 'stale', 'reason', 'team_overlap');
  end if;

  select count(*)::integer into opponent_original_other
  from public.tournament_matches as match
  join public.tournament_match_planning as planning on planning.match_id = match.id
  where match.tournament_id = request.tournament_id
    and match.id <> request.match_id
    and (request.swap_match_id is null or match.id <> request.swap_match_id)
    and opponent_team_id in (match.team_a_id, match.team_b_id)
    and planning.play_date = target_plan.play_date;

  select count(*)::integer into opponent_target_other
  from public.tournament_matches as match
  join public.tournament_match_planning as planning on planning.match_id = match.id
  where match.tournament_id = request.tournament_id
    and match.id <> request.match_id
    and (request.swap_match_id is null or match.id <> request.swap_match_id)
    and opponent_team_id in (match.team_a_id, match.team_b_id)
    and planning.play_date = request.target_play_date;

  if opponent_target_other > opponent_original_other then
    perform public.mark_tournament_reschedule_stale(request.id, 'other_team_daily_load_increased');
    return jsonb_build_object('status', 'stale', 'reason', 'other_team_daily_load_increased');
  end if;

  if not manual_agreement_override and exists (
    select 1 from public.tournament_team_availability_slots as availability
    where availability.team_id = opponent_team_id
  ) and not exists (
    select 1 from public.tournament_team_availability_slots as availability
    where availability.team_id = opponent_team_id
      and availability.play_date = request.target_play_date
      and availability.starts_at = request.target_starts_at
      and availability.ends_at = request.target_ends_at
  ) then
    perform public.mark_tournament_reschedule_stale(request.id, 'affected_team_unavailable');
    return jsonb_build_object('status', 'stale', 'reason', 'affected_team_unavailable');
  end if;

  if request.proposal_kind = 'swap' then
    select count(*)::integer into swap_a_original_other
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    where match.tournament_id = request.tournament_id
      and match.id not in (request.match_id, request.swap_match_id)
      and swap_team_a_id in (match.team_a_id, match.team_b_id)
      and planning.play_date = swap_plan.play_date;

    select count(*)::integer into swap_a_target_other
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    where match.tournament_id = request.tournament_id
      and match.id not in (request.match_id, request.swap_match_id)
      and swap_team_a_id in (match.team_a_id, match.team_b_id)
      and planning.play_date = request.swap_return_play_date;

    select count(*)::integer into swap_b_original_other
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    where match.tournament_id = request.tournament_id
      and match.id not in (request.match_id, request.swap_match_id)
      and swap_team_b_id in (match.team_a_id, match.team_b_id)
      and planning.play_date = swap_plan.play_date;

    select count(*)::integer into swap_b_target_other
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    where match.tournament_id = request.tournament_id
      and match.id not in (request.match_id, request.swap_match_id)
      and swap_team_b_id in (match.team_a_id, match.team_b_id)
      and planning.play_date = request.swap_return_play_date;

    if swap_a_target_other > swap_a_original_other
      or swap_b_target_other > swap_b_original_other then
      perform public.mark_tournament_reschedule_stale(request.id, 'other_team_daily_load_increased');
      return jsonb_build_object('status', 'stale', 'reason', 'other_team_daily_load_increased');
    end if;

    if not manual_agreement_override and (
      exists (
        select 1 from public.tournament_team_availability_slots as availability
        where availability.team_id = swap_team_a_id
      ) and not exists (
        select 1 from public.tournament_team_availability_slots as availability
        where availability.team_id = swap_team_a_id
          and availability.play_date = request.swap_return_play_date
          and availability.starts_at = request.swap_return_starts_at
          and availability.ends_at = request.swap_return_ends_at
      )
    ) or (
      exists (
        select 1 from public.tournament_team_availability_slots as availability
        where availability.team_id = swap_team_b_id
      ) and not exists (
        select 1 from public.tournament_team_availability_slots as availability
        where availability.team_id = swap_team_b_id
          and availability.play_date = request.swap_return_play_date
          and availability.starts_at = request.swap_return_starts_at
          and availability.ends_at = request.swap_return_ends_at
      )
    ) then
      perform public.mark_tournament_reschedule_stale(request.id, 'affected_team_unavailable');
      return jsonb_build_object('status', 'stale', 'reason', 'affected_team_unavailable');
    end if;
  end if;

  if target_match.phase = 'finals' then
    select exists (
      select 1
      from public.tournament_final_planning_nodes as node
      where node.tournament_id = target_match.tournament_id
        and node.series_id = target_match.series_id
        and node.round_number = target_match.final_round_number
        and node.display_order = target_match.display_order
    ) into target_node_exists;

    if target_node_exists and exists (
      select 1
      from public.tournament_final_planning_nodes as node
      where node.tournament_id = target_match.tournament_id
        and node.series_id = target_match.series_id
        and node.round_number = target_match.final_round_number
        and node.display_order = target_match.display_order
        and (
          node.resource_id is distinct from target_plan.resource_id
          or node.play_date is distinct from target_plan.play_date
          or node.starts_at is distinct from target_plan.starts_at
          or node.ends_at is distinct from target_plan.ends_at
        )
    ) then
      perform public.mark_tournament_reschedule_stale(request.id, 'final_grid_changed');
      return jsonb_build_object('status', 'stale', 'reason', 'final_grid_changed');
    end if;

    if request.proposal_kind = 'swap' then
      select exists (
        select 1
        from public.tournament_final_planning_nodes as node
        where node.tournament_id = swap_match.tournament_id
          and node.series_id = swap_match.series_id
          and node.round_number = swap_match.final_round_number
          and node.display_order = swap_match.display_order
      ) into swap_node_exists;

      if swap_node_exists and exists (
        select 1
        from public.tournament_final_planning_nodes as node
        where node.tournament_id = swap_match.tournament_id
          and node.series_id = swap_match.series_id
          and node.round_number = swap_match.final_round_number
          and node.display_order = swap_match.display_order
          and (
            node.resource_id is distinct from swap_plan.resource_id
            or node.play_date is distinct from swap_plan.play_date
            or node.starts_at is distinct from swap_plan.starts_at
            or node.ends_at is distinct from swap_plan.ends_at
          )
      ) then
        perform public.mark_tournament_reschedule_stale(request.id, 'final_grid_changed');
        return jsonb_build_object('status', 'stale', 'reason', 'final_grid_changed');
      end if;
    end if;

    if exists (
      select 1
      from public.tournament_final_planning_nodes as node
      where node.tournament_id = target_match.tournament_id
        and node.resource_id = request.target_resource_id
        and node.play_date = request.target_play_date
        and node.starts_at = request.target_starts_at
        and not (
          node.series_id = target_match.series_id
          and node.round_number = target_match.final_round_number
          and node.display_order = target_match.display_order
        )
        and not (
          request.proposal_kind = 'swap'
          and node.series_id = swap_match.series_id
          and node.round_number = swap_match.final_round_number
          and node.display_order = swap_match.display_order
        )
    ) then
      perform public.mark_tournament_reschedule_stale(request.id, 'final_grid_slot_reserved');
      return jsonb_build_object('status', 'stale', 'reason', 'final_grid_slot_reserved');
    end if;
  end if;

  before_snapshot := jsonb_build_object(
    'match', jsonb_build_object(
      'match_id', target_plan.match_id,
      'resource_id', target_plan.resource_id,
      'play_date', target_plan.play_date,
      'starts_at', target_plan.starts_at,
      'ends_at', target_plan.ends_at,
      'source', target_plan.source
    ),
    'swap_match', case when request.proposal_kind = 'swap' then
      jsonb_build_object(
        'match_id', swap_plan.match_id,
        'resource_id', swap_plan.resource_id,
        'play_date', swap_plan.play_date,
        'starts_at', swap_plan.starts_at,
        'ends_at', swap_plan.ends_at,
        'source', swap_plan.source
      )
      else null
    end
  );

  begin
    if request.proposal_kind = 'free_slot' then
      update public.tournament_match_planning
      set
        resource_id = request.target_resource_id,
        play_date = request.target_play_date,
        starts_at = request.target_starts_at,
        ends_at = request.target_ends_at,
        source = 'manual',
        updated_at = now()
      where match_id = request.match_id;

      if target_match.phase = 'finals' and target_node_exists then
        update public.tournament_final_planning_nodes
        set
          resource_id = request.target_resource_id,
          play_date = request.target_play_date,
          starts_at = request.target_starts_at,
          ends_at = request.target_ends_at,
          source = 'manual',
          updated_at = now()
        where tournament_id = target_match.tournament_id
          and series_id = target_match.series_id
          and round_number = target_match.final_round_number
          and display_order = target_match.display_order;
      end if;

      perform public.sync_tournament_reschedule_match_event(
        request.match_id,
        request.target_resource_id,
        request.target_play_date,
        request.target_starts_at,
        request.target_ends_at
      );
    else
      delete from public.tournament_match_planning
      where match_id in (request.match_id, request.swap_match_id);

      insert into public.tournament_match_planning(
        match_id, tournament_id, resource_id, play_date, starts_at, ends_at,
        source, created_at, updated_at
      ) values (
        target_plan.match_id,
        target_plan.tournament_id,
        request.target_resource_id,
        request.target_play_date,
        request.target_starts_at,
        request.target_ends_at,
        'manual',
        target_plan.created_at,
        now()
      ), (
        swap_plan.match_id,
        swap_plan.tournament_id,
        request.swap_return_resource_id,
        request.swap_return_play_date,
        request.swap_return_starts_at,
        request.swap_return_ends_at,
        'manual',
        swap_plan.created_at,
        now()
      );

      if target_match.phase = 'finals' then
        update public.tournament_final_planning_nodes
        set
          resource_id = null,
          play_date = null,
          starts_at = null,
          ends_at = null,
          source = null,
          updated_at = now()
        where tournament_id = target_match.tournament_id
          and (
            (
              series_id = target_match.series_id
              and round_number = target_match.final_round_number
              and display_order = target_match.display_order
            )
            or (
              series_id = swap_match.series_id
              and round_number = swap_match.final_round_number
              and display_order = swap_match.display_order
            )
          );

        if target_node_exists then
          update public.tournament_final_planning_nodes
          set
            resource_id = request.target_resource_id,
            play_date = request.target_play_date,
            starts_at = request.target_starts_at,
            ends_at = request.target_ends_at,
            source = 'manual',
            updated_at = now()
          where tournament_id = target_match.tournament_id
            and series_id = target_match.series_id
            and round_number = target_match.final_round_number
            and display_order = target_match.display_order;
        end if;

        if swap_node_exists then
          update public.tournament_final_planning_nodes
          set
            resource_id = request.swap_return_resource_id,
            play_date = request.swap_return_play_date,
            starts_at = request.swap_return_starts_at,
            ends_at = request.swap_return_ends_at,
            source = 'manual',
            updated_at = now()
          where tournament_id = swap_match.tournament_id
            and series_id = swap_match.series_id
            and round_number = swap_match.final_round_number
            and display_order = swap_match.display_order;
        end if;
      end if;

      -- Les deux occupations source appartiennent aux deux matchs de l'échange.
      -- On les libère ensemble avant de recréer l'une ou l'autre, sinon le
      -- premier déplacement entre en conflit avec le second créneau encore occupé.
      delete from public.calendar_occupations as occupation
      using public.event_resources as event_resource
      where event_resource.event_id in (target_event_id, swap_event_id)
        and event_resource.calendar_occupation_id = occupation.id;

      perform public.sync_tournament_reschedule_match_event(
        request.match_id,
        request.target_resource_id,
        request.target_play_date,
        request.target_starts_at,
        request.target_ends_at
      );

      perform public.sync_tournament_reschedule_match_event(
        request.swap_match_id,
        request.swap_return_resource_id,
        request.swap_return_play_date,
        request.swap_return_starts_at,
        request.swap_return_ends_at
      );
    end if;

    update public.tournament_matches
    set updated_at = now()
    where id in (request.match_id, request.swap_match_id);
  exception
    when exclusion_violation or unique_violation then
      mutation_conflict := true;
  end;

  if mutation_conflict then
    perform public.mark_tournament_reschedule_stale(request.id, 'calendar_or_planning_conflict');
    return jsonb_build_object(
      'status', 'stale',
      'reason', 'calendar_or_planning_conflict'
    );
  end if;

  after_snapshot := jsonb_build_object(
    'match', jsonb_build_object(
      'match_id', request.match_id,
      'resource_id', request.target_resource_id,
      'play_date', request.target_play_date,
      'starts_at', request.target_starts_at,
      'ends_at', request.target_ends_at,
      'source', 'manual'
    ),
    'swap_match', case when request.proposal_kind = 'swap' then
      jsonb_build_object(
        'match_id', request.swap_match_id,
        'resource_id', request.swap_return_resource_id,
        'play_date', request.swap_return_play_date,
        'starts_at', request.swap_return_starts_at,
        'ends_at', request.swap_return_ends_at,
        'source', 'manual'
      )
      else null
    end
  );

  update public.tournament_reschedule_requests
  set
    status = 'applied',
    applied_by = auth.uid(),
    applied_at = now(),
    stale_reason = null,
    application_snapshot = jsonb_build_object(
      'before', before_snapshot,
      'after', after_snapshot
    ),
    updated_at = now()
  where id = request.id;

  insert into public.tournament_audit_log(
    tournament_id, action, payload, created_by
  ) values (
    request.tournament_id,
    'reschedule_applied',
    jsonb_build_object(
      'request_id', request.id,
      'proposal_kind', request.proposal_kind,
      'match_id', request.match_id,
      'swap_match_id', request.swap_match_id,
      'before', before_snapshot,
      'after', after_snapshot
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'status', 'applied',
    'request_id', request.id,
    'match_id', request.match_id,
    'swap_match_id', request.swap_match_id,
    'applied_at', now()
  );
end;
$function$
;
commit;
