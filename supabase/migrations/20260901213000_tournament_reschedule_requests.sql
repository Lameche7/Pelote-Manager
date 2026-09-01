begin;

-- PR127 — circuit d'accord des reports de parties.
-- Cette migration ne déplace aucun match. Elle fige une proposition issue du
-- moteur de suggestions, recueille un accord par équipe concernée et expose le
-- suivi joueur / administrateur. L'application transactionnelle du déplacement
-- sera activée dans une étape séparée après validation fonctionnelle de ce flux.

create table if not exists public.tournament_reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  match_id uuid not null references public.tournament_matches (id) on delete cascade,
  requester_team_id uuid not null references public.tournament_teams (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  proposal_kind text not null check (proposal_kind in ('free_slot', 'swap')),
  swap_match_id uuid references public.tournament_matches (id) on delete cascade,
  target_resource_id uuid not null references public.reservable_resources (id) on delete restrict,
  target_play_date date not null,
  target_starts_at time not null,
  target_ends_at time not null,
  swap_return_resource_id uuid references public.reservable_resources (id) on delete restrict,
  swap_return_play_date date,
  swap_return_starts_at time,
  swap_return_ends_at time,
  proposal_snapshot jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'stale', 'applied')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_ends_at > target_starts_at),
  check (
    (proposal_kind = 'free_slot'
      and swap_match_id is null
      and swap_return_resource_id is null
      and swap_return_play_date is null
      and swap_return_starts_at is null
      and swap_return_ends_at is null)
    or
    (proposal_kind = 'swap'
      and swap_match_id is not null
      and swap_return_resource_id is not null
      and swap_return_play_date is not null
      and swap_return_starts_at is not null
      and swap_return_ends_at is not null
      and swap_return_ends_at > swap_return_starts_at)
  )
);

create table if not exists public.tournament_reschedule_approvals (
  request_id uuid not null references public.tournament_reschedule_requests (id) on delete cascade,
  team_id uuid not null references public.tournament_teams (id) on delete cascade,
  decision text not null default 'pending'
    check (decision in ('pending', 'approved', 'rejected')),
  is_requester boolean not null default false,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (request_id, team_id),
  check (
    (decision = 'pending' and decided_by is null and decided_at is null)
    or
    (decision <> 'pending' and decided_at is not null)
  )
);

create unique index if not exists tournament_reschedule_requests_active_match_idx
on public.tournament_reschedule_requests (match_id)
where status in ('pending', 'approved');

create index if not exists tournament_reschedule_requests_tournament_idx
on public.tournament_reschedule_requests (tournament_id, created_at desc);

create index if not exists tournament_reschedule_approvals_team_idx
on public.tournament_reschedule_approvals (team_id, decision, created_at desc);

alter table public.tournament_reschedule_requests enable row level security;
alter table public.tournament_reschedule_approvals enable row level security;

revoke all on table public.tournament_reschedule_requests
from public, anon, authenticated;
revoke all on table public.tournament_reschedule_approvals
from public, anon, authenticated;

create or replace function public.tournament_team_app_actor_count(
  target_team_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct profile.id)::integer
  from public.profiles as profile
  where public.tournament_profile_can_act_for_team(target_team_id, profile.id);
$$;

revoke all on function public.tournament_team_app_actor_count(uuid)
from public, anon, authenticated;

create or replace function public.create_my_tournament_reschedule_request(
  target_match_id uuid,
  requester_team_id uuid,
  proposal jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  options jsonb;
  candidate jsonb;
  proposal_kind text := btrim(coalesce(proposal->>'kind', ''));
  request_id uuid;
  tournament_id uuid;
  opponent_team_id uuid;
  swap_team_a_id uuid;
  swap_team_b_id uuid;
  original_resource_id uuid;
  original_resource_timezone text;
  original_play_date date;
  original_starts_at time;
  expires_at timestamptz;
  required_team_id uuid;
  required_team_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if proposal_kind not in ('free_slot', 'swap') then
    raise exception 'Tournament reschedule proposal is invalid' using errcode = '22023';
  end if;

  -- Réexécute toutes les validations du moteur au moment exact où la demande
  -- est créée. Le client ne peut donc pas fabriquer un créneau arbitraire.
  options := public.get_my_tournament_reschedule_options(
    target_match_id,
    requester_team_id
  );

  if proposal_kind = 'free_slot' then
    select item.value
    into candidate
    from jsonb_array_elements(coalesce(options->'free_slots', '[]'::jsonb)) as item(value)
    where item.value->>'resource_id' = proposal->>'resource_id'
      and item.value->>'play_date' = proposal->>'play_date'
      and left(item.value->>'starts_at', 5) = left(proposal->>'starts_at', 5)
      and left(item.value->>'ends_at', 5) = left(proposal->>'ends_at', 5)
    limit 1;
  else
    select item.value
    into candidate
    from jsonb_array_elements(coalesce(options->'swaps', '[]'::jsonb)) as item(value)
    where item.value->>'swap_match_id' = proposal->>'swap_match_id'
    limit 1;
  end if;

  if candidate is null then
    raise exception 'Tournament reschedule proposal is no longer available'
      using errcode = 'P0001';
  end if;

  tournament_id := (
    select match.tournament_id
    from public.tournament_matches as match
    where match.id = target_match_id
  );

  if exists (
    select 1
    from public.tournament_reschedule_requests as existing
    where existing.match_id = target_match_id
      and existing.status in ('pending', 'approved')
  ) then
    raise exception 'Tournament match already has an active reschedule request'
      using errcode = '23505';
  end if;

  opponent_team_id := (options#>>'{match,opponent_team_id}')::uuid;
  original_resource_id := (options#>>'{match,resource_id}')::uuid;
  original_play_date := (options#>>'{match,play_date}')::date;
  original_starts_at := (options#>>'{match,starts_at}')::time;

  select resource.timezone
  into original_resource_timezone
  from public.reservable_resources as resource
  where resource.id = original_resource_id;

  if original_resource_timezone is null then
    raise exception 'Tournament match resource is invalid' using errcode = 'P0001';
  end if;

  expires_at := public.tournament_planning_starts_at(
    original_play_date,
    original_starts_at,
    original_resource_timezone
  );

  if expires_at <= now() then
    raise exception 'Tournament match has already started' using errcode = 'P0001';
  end if;

  if proposal_kind = 'swap' then
    swap_team_a_id := (candidate->>'swap_team_a_id')::uuid;
    swap_team_b_id := (candidate->>'swap_team_b_id')::uuid;
  end if;

  insert into public.tournament_reschedule_requests (
    tournament_id,
    match_id,
    requester_team_id,
    requested_by,
    proposal_kind,
    swap_match_id,
    target_resource_id,
    target_play_date,
    target_starts_at,
    target_ends_at,
    swap_return_resource_id,
    swap_return_play_date,
    swap_return_starts_at,
    swap_return_ends_at,
    proposal_snapshot,
    expires_at
  )
  values (
    tournament_id,
    target_match_id,
    requester_team_id,
    auth.uid(),
    proposal_kind,
    case when proposal_kind = 'swap' then (candidate->>'swap_match_id')::uuid else null end,
    (candidate->>'resource_id')::uuid,
    (candidate->>'play_date')::date,
    (candidate->>'starts_at')::time,
    (candidate->>'ends_at')::time,
    case when proposal_kind = 'swap' then (candidate->>'swap_moves_to_resource_id')::uuid else null end,
    case when proposal_kind = 'swap' then (candidate->>'swap_moves_to_play_date')::date else null end,
    case when proposal_kind = 'swap' then (candidate->>'swap_moves_to_starts_at')::time else null end,
    case when proposal_kind = 'swap' then (candidate->>'swap_moves_to_ends_at')::time else null end,
    jsonb_build_object(
      'match', options->'match',
      'policy', options->'policy',
      'proposal', candidate
    ),
    expires_at
  )
  returning id into request_id;

  required_team_ids := array[requester_team_id, opponent_team_id];
  if proposal_kind = 'swap' then
    required_team_ids := required_team_ids || array[swap_team_a_id, swap_team_b_id];
  end if;

  foreach required_team_id in array required_team_ids
  loop
    insert into public.tournament_reschedule_approvals (
      request_id,
      team_id,
      decision,
      is_requester,
      decided_by,
      decided_at
    )
    values (
      request_id,
      required_team_id,
      case when required_team_id = requester_team_id then 'approved' else 'pending' end,
      required_team_id = requester_team_id,
      case when required_team_id = requester_team_id then auth.uid() else null end,
      case when required_team_id = requester_team_id then now() else null end
    )
    on conflict (request_id, team_id) do nothing;
  end loop;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    payload,
    created_by
  )
  values (
    tournament_id,
    'reschedule_requested',
    jsonb_build_object(
      'request_id', request_id,
      'match_id', target_match_id,
      'requester_team_id', requester_team_id,
      'proposal_kind', proposal_kind,
      'proposal', candidate
    ),
    auth.uid()
  );

  return request_id;
end;
$$;

revoke all on function public.create_my_tournament_reschedule_request(uuid, uuid, jsonb)
from public, anon;
grant execute on function public.create_my_tournament_reschedule_request(uuid, uuid, jsonb)
to authenticated;

create or replace function public.get_my_tournament_reschedule_requests()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
        'expires_at', request.expires_at,
        'created_at', request.created_at,
        'can_cancel', request.requested_by = auth.uid()
          and request.status in ('pending', 'approved'),
        'approvals', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'team_id', approval.team_id,
                'team_label', public.tournament_team_public_label(approval.team_id),
                'decision', approval.decision,
                'is_requester', approval.is_requester,
                'can_act', approval.decision = 'pending'
                  and request.status = 'pending'
                  and public.tournament_profile_can_act_for_team(approval.team_id, auth.uid()),
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
  from public.tournament_reschedule_requests as request
  join public.tournaments as tournament on tournament.id = request.tournament_id
  where request.requested_by = auth.uid()
    or exists (
      select 1
      from public.tournament_reschedule_approvals as approval
      where approval.request_id = request.id
        and public.tournament_profile_can_act_for_team(approval.team_id, auth.uid())
    );
$$;

revoke all on function public.get_my_tournament_reschedule_requests()
from public, anon;
grant execute on function public.get_my_tournament_reschedule_requests()
to authenticated;

create or replace function public.decide_my_tournament_reschedule_request(
  target_request_id uuid,
  acting_team_id uuid,
  target_decision text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.tournament_reschedule_requests%rowtype;
  approval public.tournament_reschedule_approvals%rowtype;
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if target_decision not in ('approved', 'rejected') then
    raise exception 'Tournament reschedule decision is invalid' using errcode = '22023';
  end if;

  select item.*
  into request
  from public.tournament_reschedule_requests as item
  where item.id = target_request_id
  for update;

  if request.id is null then
    raise exception 'Tournament reschedule request not found' using errcode = 'P0002';
  end if;

  if request.status <> 'pending' then
    raise exception 'Tournament reschedule request is no longer pending' using errcode = 'P0001';
  end if;

  if request.expires_at <= now() then
    update public.tournament_reschedule_requests
    set status = 'stale', updated_at = now()
    where id = request.id;

    insert into public.tournament_audit_log (
      tournament_id, action, payload, created_by
    ) values (
      request.tournament_id,
      'reschedule_stale',
      jsonb_build_object('request_id', request.id, 'reason', 'match_started'),
      auth.uid()
    );

    return 'stale';
  end if;

  select item.*
  into approval
  from public.tournament_reschedule_approvals as item
  where item.request_id = request.id
    and item.team_id = acting_team_id
  for update;

  if approval.request_id is null
    or not public.tournament_profile_can_act_for_team(acting_team_id, auth.uid()) then
    raise exception 'Tournament team cannot decide this reschedule'
      using errcode = '42501';
  end if;

  if approval.decision <> 'pending' then
    raise exception 'Tournament team has already decided this reschedule'
      using errcode = 'P0001';
  end if;

  update public.tournament_reschedule_approvals
  set
    decision = target_decision,
    decided_by = auth.uid(),
    decided_at = now()
  where request_id = request.id
    and team_id = acting_team_id;

  if target_decision = 'rejected' then
    next_status := 'rejected';
  elsif not exists (
    select 1
    from public.tournament_reschedule_approvals as remaining
    where remaining.request_id = request.id
      and remaining.decision = 'pending'
  ) then
    next_status := 'approved';
  else
    next_status := 'pending';
  end if;

  update public.tournament_reschedule_requests
  set status = next_status, updated_at = now()
  where id = request.id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    payload,
    created_by
  )
  values (
    request.tournament_id,
    case when target_decision = 'approved'
      then 'reschedule_team_approved'
      else 'reschedule_team_rejected'
    end,
    jsonb_build_object(
      'request_id', request.id,
      'team_id', acting_team_id,
      'request_status', next_status
    ),
    auth.uid()
  );

  return next_status;
end;
$$;

revoke all on function public.decide_my_tournament_reschedule_request(uuid, uuid, text)
from public, anon;
grant execute on function public.decide_my_tournament_reschedule_request(uuid, uuid, text)
to authenticated;

create or replace function public.cancel_my_tournament_reschedule_request(
  target_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.tournament_reschedule_requests%rowtype;
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

  if request.requested_by <> auth.uid() then
    raise exception 'Tournament reschedule request cannot be cancelled by this profile'
      using errcode = '42501';
  end if;

  if request.status not in ('pending', 'approved') then
    raise exception 'Tournament reschedule request cannot be cancelled'
      using errcode = 'P0001';
  end if;

  update public.tournament_reschedule_requests
  set status = 'cancelled', updated_at = now()
  where id = request.id;

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    payload,
    created_by
  )
  values (
    request.tournament_id,
    'reschedule_cancelled',
    jsonb_build_object('request_id', request.id),
    auth.uid()
  );
end;
$$;

revoke all on function public.cancel_my_tournament_reschedule_request(uuid)
from public, anon;
grant execute on function public.cancel_my_tournament_reschedule_request(uuid)
to authenticated;

create or replace function public.admin_list_tournament_reschedule_requests(
  target_tournament_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  result jsonb;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
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
        'expires_at', request.expires_at,
        'created_at', request.created_at,
        'approvals', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'team_id', approval.team_id,
                'team_label', public.tournament_team_public_label(approval.team_id),
                'decision', approval.decision,
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
$$;

revoke all on function public.admin_list_tournament_reschedule_requests(uuid)
from public, anon;
grant execute on function public.admin_list_tournament_reschedule_requests(uuid)
to authenticated;

commit;
