-- Tourney-scoped, opt-in deadline policy. Other tournaments retain their
-- existing reporting behavior. Dates are inclusive last playing days.
create table if not exists public.tournament_final_reschedule_deadlines (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  final_round text not null check (final_round in (
    'preliminary','round_of_16','quarterfinal','semifinal'
  )),
  last_play_date date not null,
  primary key (tournament_id,final_round)
);
alter table public.tournament_final_reschedule_deadlines enable row level security;
revoke all on public.tournament_final_reschedule_deadlines from public,anon,authenticated;
-- November 2026 Lourdes tournament only.
insert into public.tournament_final_reschedule_deadlines
(tournament_id,final_round,last_play_date) values
('3de17177-a915-404f-8a6e-14bf42158982','preliminary','2026-11-26'),
('3de17177-a915-404f-8a6e-14bf42158982','round_of_16','2026-11-26'),
('3de17177-a915-404f-8a6e-14bf42158982','quarterfinal','2026-12-03'),
('3de17177-a915-404f-8a6e-14bf42158982','semifinal','2026-12-09')
on conflict (tournament_id,final_round)
do update set last_play_date=excluded.last_play_date;

create or replace function public.tournament_final_reschedule_last_play_date(
  target_tournament_id uuid,target_round text
) returns date
language sql stable security definer set search_path=''
as $function$
  select d.last_play_date
  from public.tournament_final_reschedule_deadlines d
  where d.tournament_id=target_tournament_id and d.final_round=target_round
$function$;
revoke all on function public.tournament_final_reschedule_last_play_date(uuid,text)
from public,anon;
grant execute on function public.tournament_final_reschedule_last_play_date(uuid,text)
to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_tournament_reschedule_options(target_match_id uuid, requester_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  filtered_free_slots jsonb;
  filtered_swaps jsonb;
  latest_play_date date;
  selected_match public.tournament_matches%rowtype;
begin
  select m.* into selected_match
  from public.tournament_matches m where m.id=target_match_id;
  latest_play_date := public.tournament_final_reschedule_last_play_date(
    selected_match.tournament_id,selected_match.final_round
  );
  result := public.get_my_tournament_reschedule_options_unfiltered(
    target_match_id,
    requester_team_id
  );

  select coalesce(jsonb_agg(item.value), '[]'::jsonb)
  into filtered_free_slots
  from jsonb_array_elements(
    coalesce(result->'free_slots', '[]'::jsonb)
  ) as item(value)
  where (latest_play_date is null or (item.value->>'play_date')::date <= latest_play_date)
    and not public.tournament_reschedule_slot_is_held(
    nullif(item.value->>'resource_id', '')::uuid,
    nullif(item.value->>'play_date', '')::date,
    nullif(item.value->>'starts_at', '')::time,
    nullif(item.value->>'ends_at', '')::time
  );

  select coalesce(jsonb_agg(item.value), '[]'::jsonb)
  into filtered_swaps
  from jsonb_array_elements(
    coalesce(result->'swaps', '[]'::jsonb)
  ) as item(value)
  where (latest_play_date is null or (item.value->>'play_date')::date <= latest_play_date)
    and (
      public.tournament_final_reschedule_last_play_date(
        selected_match.tournament_id,
        (select swapped.final_round
         from public.tournament_matches swapped
         where swapped.id=nullif(item.value->>'swap_match_id','')::uuid
           and swapped.tournament_id=selected_match.tournament_id)
      ) is null
      or (item.value->>'swap_moves_to_play_date')::date <=
      public.tournament_final_reschedule_last_play_date(
        selected_match.tournament_id,
        (select swapped.final_round from public.tournament_matches swapped
         where swapped.id=nullif(item.value->>'swap_match_id','')::uuid
           and swapped.tournament_id=selected_match.tournament_id)
      )
    )
    and not public.tournament_reschedule_slot_is_held(
    nullif(item.value->>'resource_id', '')::uuid,
    nullif(item.value->>'play_date', '')::date,
    nullif(item.value->>'starts_at', '')::time,
    nullif(item.value->>'ends_at', '')::time
  )
    and not exists (
      select 1
      from public.tournament_reschedule_active_matches as active
      where active.match_id = nullif(item.value->>'swap_match_id', '')::uuid
    );

  return jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(result, '{}'::jsonb),
        '{policy,latest_play_date}',
        to_jsonb(latest_play_date),
        true
      ),
      '{free_slots}',
      filtered_free_slots,
      true
    ),
    '{swaps}',
    filtered_swaps,
    true
  );
end;
$function$;

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
      and result.status = 'validated'
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

  -- Recheck after approvals: an older request cannot bypass a new
  -- deadline, and swaps must respect BOTH matches' own final rounds.
  if (
    public.tournament_final_reschedule_last_play_date(
      request.tournament_id,target_match.final_round
    ) is not null
    and request.target_play_date >
      public.tournament_final_reschedule_last_play_date(
        request.tournament_id,target_match.final_round
      )
  ) or (
    request.proposal_kind='swap'
    and public.tournament_final_reschedule_last_play_date(
      request.tournament_id,swap_match.final_round
    ) is not null
    and request.swap_return_play_date >
      public.tournament_final_reschedule_last_play_date(
        request.tournament_id,swap_match.final_round
      )
  ) then
    perform public.mark_tournament_reschedule_stale(
      request.id,'final_stage_reschedule_deadline'
    );
    return jsonb_build_object(
      'status','stale','reason','final_stage_reschedule_deadline'
    );
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
$function$;
