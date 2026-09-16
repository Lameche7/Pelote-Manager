begin;

-- Permet à l'organisation de créer une demande de report lorsqu'une équipe
-- n'utilise pas encore PILOTOKI. Le déplacement reste soumis au même circuit
-- d'accord et à la même application transactionnelle que les demandes joueurs.

create or replace function public.admin_get_tournament_manual_reschedule_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if target_club_id is null
    or not public.has_club_permission(target_club_id, 'tournaments.manage') then
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
              and match.team_a_id is not null
              and match.team_b_id is not null
              and public.tournament_planning_starts_at(
                planning.play_date,
                planning.starts_at,
                resource.timezone
              ) > now()
              and not exists (
                select 1
                from public.tournament_match_results as result
                where result.match_id = match.id
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
$$;

revoke all on function public.admin_get_tournament_manual_reschedule_context()
from public, anon, authenticated;
grant execute on function public.admin_get_tournament_manual_reschedule_context()
to authenticated;

create or replace function public.admin_get_tournament_manual_reschedule_slots(
  target_match_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_match public.tournament_matches%rowtype;
  target_tournament public.tournaments%rowtype;
  target_planning public.tournament_match_planning%rowtype;
  target_resource public.reservable_resources%rowtype;
begin
  if target_club_id is null
    or not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = target_match_id;

  if target_match.id is null then
    raise exception 'Tournament match not found' using errcode = 'P0002';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_match.tournament_id
    and tournament.club_id = target_club_id;

  if target_tournament.id is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if target_tournament.status not in ('planning_published', 'in_progress') then
    raise exception 'Tournament reschedule is not available at this stage'
      using errcode = 'P0001';
  end if;

  select planning.*
  into target_planning
  from public.tournament_match_planning as planning
  where planning.match_id = target_match.id;

  if target_planning.match_id is null then
    raise exception 'Tournament match is not scheduled' using errcode = 'P0001';
  end if;

  select resource.*
  into target_resource
  from public.reservable_resources as resource
  where resource.id = target_planning.resource_id;

  if target_resource.id is null then
    raise exception 'Tournament match resource is invalid' using errcode = 'P0001';
  end if;

  if public.tournament_planning_starts_at(
    target_planning.play_date,
    target_planning.starts_at,
    target_resource.timezone
  ) <= now() then
    raise exception 'Tournament match has already started' using errcode = 'P0001';
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

  return (
    with candidate_slots as (
      select
        selected.resource_id,
        resource.name as resource_name,
        resource.timezone as resource_timezone,
        generated.play_date,
        generated.starts_at,
        generated.ends_at,
        public.tournament_planning_starts_at(
          generated.play_date,
          generated.starts_at,
          resource.timezone
        ) as absolute_starts_at,
        public.tournament_planning_starts_at(
          generated.play_date,
          generated.ends_at,
          resource.timezone
        ) as absolute_ends_at
      from public.tournament_generated_slots(target_tournament.id) as generated
      join public.tournament_resources as selected
        on selected.tournament_id = target_tournament.id
      join public.reservable_resources as resource
        on resource.id = selected.resource_id
       and resource.is_active
      where generated.phase = target_match.phase
    ),
    eligible as (
      select candidate.*
      from candidate_slots as candidate
      where candidate.absolute_starts_at > now()
        and not (
          candidate.resource_id = target_planning.resource_id
          and candidate.play_date = target_planning.play_date
          and candidate.starts_at = target_planning.starts_at
          and candidate.ends_at = target_planning.ends_at
        )
        and not exists (
          select 1
          from public.calendar_occupations as occupation
          where occupation.resource_id = candidate.resource_id
            and occupation.cancelled_at is null
            and occupation.starts_at < candidate.absolute_ends_at
            and occupation.ends_at > candidate.absolute_starts_at
            and occupation.id not in (
              select event_resource.calendar_occupation_id
              from public.tournament_match_events as own_link
              join public.event_resources as event_resource
                on event_resource.event_id = own_link.event_id
              where own_link.match_id = target_match.id
                and event_resource.calendar_occupation_id is not null
            )
        )
        and not exists (
          select 1
          from public.tournament_matches as other_match
          join public.tournament_match_planning as other_planning
            on other_planning.match_id = other_match.id
          where other_match.tournament_id = target_tournament.id
            and other_match.id <> target_match.id
            and other_planning.resource_id = candidate.resource_id
            and other_planning.play_date = candidate.play_date
            and other_planning.starts_at < candidate.ends_at
            and other_planning.ends_at > candidate.starts_at
        )
        and not exists (
          select 1
          from public.tournament_matches as other_match
          join public.tournament_match_planning as other_planning
            on other_planning.match_id = other_match.id
          where other_match.tournament_id = target_tournament.id
            and other_match.id <> target_match.id
            and (
              target_match.team_a_id in (other_match.team_a_id, other_match.team_b_id)
              or target_match.team_b_id in (other_match.team_a_id, other_match.team_b_id)
            )
            and other_planning.play_date = candidate.play_date
            and other_planning.starts_at < candidate.ends_at
            and other_planning.ends_at > candidate.starts_at
        )
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'resource_id', eligible.resource_id,
          'resource_name', eligible.resource_name,
          'play_date', eligible.play_date,
          'starts_at', eligible.starts_at,
          'ends_at', eligible.ends_at
        )
        order by eligible.play_date, eligible.starts_at, eligible.resource_name
      ),
      '[]'::jsonb
    )
    from eligible
  );
end;
$$;

revoke all on function public.admin_get_tournament_manual_reschedule_slots(uuid)
from public, anon, authenticated;
grant execute on function public.admin_get_tournament_manual_reschedule_slots(uuid)
to authenticated;

create or replace function public.admin_create_tournament_manual_reschedule_request(
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

  select item.value
  into candidate
  from jsonb_array_elements(
    public.admin_get_tournament_manual_reschedule_slots(target_match.id)
  ) as item(value)
  where item.value->>'resource_id' = target_resource_id::text
    and item.value->>'play_date' = target_play_date::text
    and left(item.value->>'starts_at', 5) = left(target_starts_at::text, 5)
    and left(item.value->>'ends_at', 5) = left(target_ends_at::text, 5)
  limit 1;

  if candidate is null then
    raise exception 'Tournament reschedule proposal is no longer available'
      using errcode = 'P0001';
  end if;

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
        'requester_contact_note', normalized_note
      ),
      'proposal', candidate || jsonb_build_object(
        'kind', 'free_slot',
        'preference', 'admin_manual'
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
      'source', 'admin_manual',
      'proposal', candidate,
      'contact_note', normalized_note
    ),
    auth.uid()
  );

  return request_id;
end;
$$;

revoke all on function public.admin_create_tournament_manual_reschedule_request(
  uuid, uuid, uuid, date, time, time, text
) from public, anon, authenticated;
grant execute on function public.admin_create_tournament_manual_reschedule_request(
  uuid, uuid, uuid, date, time, time, text
) to authenticated;

commit;
