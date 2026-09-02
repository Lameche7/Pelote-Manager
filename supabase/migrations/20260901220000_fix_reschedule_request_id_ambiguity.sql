begin;

-- PR127 — corrige l'ambiguïté PL/pgSQL entre la variable locale `request_id`
-- et la colonne homonyme de tournament_reschedule_approvals. Cette migration
-- ne déplace aucun match et ne modifie aucune demande existante.
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
  new_request_id uuid;
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
  returning id into new_request_id;

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
      new_request_id,
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
      'request_id', new_request_id,
      'match_id', target_match_id,
      'requester_team_id', requester_team_id,
      'proposal_kind', proposal_kind,
      'proposal', candidate
    ),
    auth.uid()
  );

  return new_request_id;
end;
$$;

revoke all on function public.create_my_tournament_reschedule_request(uuid, uuid, jsonb)
from public, anon;
grant execute on function public.create_my_tournament_reschedule_request(uuid, uuid, jsonb)
to authenticated;

commit;
