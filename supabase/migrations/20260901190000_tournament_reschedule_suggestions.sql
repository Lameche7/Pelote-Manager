begin;

-- PR126 — moteur de suggestion de report joueur, sans aucune mutation du planning.
-- Règle métier : l'équipe qui demande le report peut accepter une solution moins
-- confortable. Les autres équipes ne doivent pas voir leur charge de parties sur
-- une même journée augmenter à cause de la demande. Le temps de repos n'est pas
-- une contrainte de ce moteur.

create or replace function public.tournament_profile_can_act_for_team(
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
    select profile.id, profile.member_id, profile.email
    from public.profiles as profile
    where profile.id = target_profile_id
  )
  select exists (
    select 1
    from public.tournament_teams as team
    cross join actor
    where team.id = target_team_id
      and team.status = 'accepted'
      and (
        team.submitted_by = actor.id
        or exists (
          select 1
          from public.tournament_team_players as player
          where player.team_id = team.id
            and (
              (
                actor.member_id is not null
                and player.member_id = actor.member_id
              )
              or (
                nullif(btrim(actor.email), '') is not null
                and nullif(btrim(player.email), '') is not null
                and lower(btrim(player.email)) = lower(btrim(actor.email))
              )
            )
        )
      )
  );
$$;

revoke all on function public.tournament_profile_can_act_for_team(uuid, uuid)
from public, anon, authenticated;

create or replace function public.get_my_tournament_reschedule_options(
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
  target_planning public.tournament_match_planning%rowtype;
  target_tournament public.tournaments%rowtype;
  target_resource public.reservable_resources%rowtype;
  opponent_team_id uuid;
  requester_label text;
  opponent_label text;
  original_starts_at timestamptz;
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

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_match.tournament_id;

  if target_tournament.id is null
    or target_tournament.status not in ('planning_published', 'in_progress') then
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

  original_starts_at := public.tournament_planning_starts_at(
    target_planning.play_date,
    target_planning.starts_at,
    target_resource.timezone
  );

  if original_starts_at <= now() then
    raise exception 'Tournament match has already started' using errcode = 'P0001';
  end if;

  opponent_team_id := case
    when target_match.team_a_id = requester_team_id then target_match.team_b_id
    else target_match.team_a_id
  end;
  requester_label := public.tournament_team_public_label(requester_team_id);
  opponent_label := public.tournament_team_public_label(opponent_team_id);

  return jsonb_build_object(
    'match', jsonb_build_object(
      'id', target_match.id,
      'phase', target_match.phase,
      'requester_team_id', requester_team_id,
      'requester_label', requester_label,
      'opponent_team_id', opponent_team_id,
      'opponent_label', opponent_label,
      'resource_id', target_planning.resource_id,
      'resource_name', target_resource.name,
      'play_date', target_planning.play_date,
      'starts_at', target_planning.starts_at,
      'ends_at', target_planning.ends_at
    ),
    'policy', jsonb_build_object(
      'minimum_rest_enforced', false,
      'requester_may_take_extra_same_day_match', true,
      'other_teams_same_day_load_protected', true
    ),
    'free_slots', (
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
      measured as (
        select
          candidate.*,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id <> target_match.id
              and requester_team_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = target_planning.play_date
          ) as requester_original_other_matches,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id <> target_match.id
              and requester_team_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = candidate.play_date
          ) as requester_target_other_matches,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id <> target_match.id
              and opponent_team_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = target_planning.play_date
          ) as opponent_original_other_matches,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id <> target_match.id
              and opponent_team_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = candidate.play_date
          ) as opponent_target_other_matches,
          exists (
            select 1
            from public.tournament_team_availability_slots as availability
            where availability.team_id = requester_team_id
          ) as requester_has_availability,
          exists (
            select 1
            from public.tournament_team_availability_slots as availability
            where availability.team_id = requester_team_id
              and availability.play_date = candidate.play_date
              and availability.starts_at = candidate.starts_at
              and availability.ends_at = candidate.ends_at
          ) as requester_declared_available,
          exists (
            select 1
            from public.tournament_team_availability_slots as availability
            where availability.team_id = opponent_team_id
          ) as opponent_has_availability,
          exists (
            select 1
            from public.tournament_team_availability_slots as availability
            where availability.team_id = opponent_team_id
              and availability.play_date = candidate.play_date
              and availability.starts_at = candidate.starts_at
              and availability.ends_at = candidate.ends_at
          ) as opponent_declared_available
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
              and (
                requester_team_id in (other_match.team_a_id, other_match.team_b_id)
                or opponent_team_id in (other_match.team_a_id, other_match.team_b_id)
              )
              and other_planning.play_date = candidate.play_date
              and other_planning.starts_at < candidate.ends_at
              and other_planning.ends_at > candidate.starts_at
          )
      ),
      eligible as (
        select
          measured.*,
          greatest(
            measured.requester_target_other_matches
              - measured.requester_original_other_matches,
            0
          ) as requester_day_penalty,
          measured.requester_has_availability
            and not measured.requester_declared_available
            as requester_outside_declared_availability
        from measured
        where measured.opponent_target_other_matches
              <= measured.opponent_original_other_matches
          and (
            not measured.opponent_has_availability
            or measured.opponent_declared_available
          )
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'kind', 'free_slot',
            'resource_id', eligible.resource_id,
            'resource_name', eligible.resource_name,
            'play_date', eligible.play_date,
            'starts_at', eligible.starts_at,
            'ends_at', eligible.ends_at,
            'requester_same_day_penalty', eligible.requester_day_penalty,
            'requester_outside_declared_availability',
              eligible.requester_outside_declared_availability,
            'opponent_availability_known', eligible.opponent_has_availability,
            'preference', case
              when eligible.requester_day_penalty = 0
                and not eligible.requester_outside_declared_availability
                then 'recommended'
              else 'requester_compromise'
            end
          )
          order by
            eligible.requester_outside_declared_availability,
            eligible.requester_day_penalty,
            abs(eligible.play_date - target_planning.play_date),
            abs(extract(epoch from (eligible.starts_at - target_planning.starts_at))),
            eligible.play_date,
            eligible.starts_at,
            eligible.resource_name
        ),
        '[]'::jsonb
      )
      from eligible
    ),
    'swaps', (
      with swap_candidates as (
        select
          other_match.id as swap_match_id,
          other_match.team_a_id as swap_team_a_id,
          other_match.team_b_id as swap_team_b_id,
          public.tournament_team_public_label(other_match.team_a_id) as swap_team_a_label,
          public.tournament_team_public_label(other_match.team_b_id) as swap_team_b_label,
          other_planning.resource_id,
          other_resource.name as resource_name,
          other_resource.timezone as resource_timezone,
          other_planning.play_date,
          other_planning.starts_at,
          other_planning.ends_at,
          public.tournament_planning_starts_at(
            other_planning.play_date,
            other_planning.starts_at,
            other_resource.timezone
          ) as absolute_starts_at,
          public.tournament_planning_starts_at(
            other_planning.play_date,
            other_planning.ends_at,
            other_resource.timezone
          ) as absolute_ends_at
        from public.tournament_matches as other_match
        join public.tournament_match_planning as other_planning
          on other_planning.match_id = other_match.id
        join public.reservable_resources as other_resource
          on other_resource.id = other_planning.resource_id
        join public.tournament_match_events as other_link
          on other_link.match_id = other_match.id
        join public.events as other_event
          on other_event.id = other_link.event_id
         and other_event.publication_status = 'published'
        left join public.tournament_match_results as other_result
          on other_result.match_id = other_match.id
        where other_match.tournament_id = target_tournament.id
          and other_match.id <> target_match.id
          and other_match.phase = target_match.phase
          and other_result.id is null
          and requester_team_id not in (other_match.team_a_id, other_match.team_b_id)
          and opponent_team_id not in (other_match.team_a_id, other_match.team_b_id)
      ),
      measured as (
        select
          candidate.*,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id not in (target_match.id, candidate.swap_match_id)
              and requester_team_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = target_planning.play_date
          ) as requester_original_other_matches,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id not in (target_match.id, candidate.swap_match_id)
              and requester_team_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = candidate.play_date
          ) as requester_target_other_matches,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id not in (target_match.id, candidate.swap_match_id)
              and opponent_team_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = target_planning.play_date
          ) as opponent_original_other_matches,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id not in (target_match.id, candidate.swap_match_id)
              and opponent_team_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = candidate.play_date
          ) as opponent_target_other_matches,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id not in (target_match.id, candidate.swap_match_id)
              and candidate.swap_team_a_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = candidate.play_date
          ) as swap_a_original_other_matches,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id not in (target_match.id, candidate.swap_match_id)
              and candidate.swap_team_a_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = target_planning.play_date
          ) as swap_a_target_other_matches,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id not in (target_match.id, candidate.swap_match_id)
              and candidate.swap_team_b_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = candidate.play_date
          ) as swap_b_original_other_matches,
          (
            select count(*)::integer
            from public.tournament_matches as other_match
            join public.tournament_match_planning as other_planning
              on other_planning.match_id = other_match.id
            where other_match.tournament_id = target_tournament.id
              and other_match.id not in (target_match.id, candidate.swap_match_id)
              and candidate.swap_team_b_id in (other_match.team_a_id, other_match.team_b_id)
              and other_planning.play_date = target_planning.play_date
          ) as swap_b_target_other_matches,
          exists (
            select 1 from public.tournament_team_availability_slots as availability
            where availability.team_id = requester_team_id
          ) as requester_has_availability,
          exists (
            select 1 from public.tournament_team_availability_slots as availability
            where availability.team_id = requester_team_id
              and availability.play_date = candidate.play_date
              and availability.starts_at = candidate.starts_at
              and availability.ends_at = candidate.ends_at
          ) as requester_declared_available,
          exists (
            select 1 from public.tournament_team_availability_slots as availability
            where availability.team_id = opponent_team_id
          ) as opponent_has_availability,
          exists (
            select 1 from public.tournament_team_availability_slots as availability
            where availability.team_id = opponent_team_id
              and availability.play_date = candidate.play_date
              and availability.starts_at = candidate.starts_at
              and availability.ends_at = candidate.ends_at
          ) as opponent_declared_available,
          exists (
            select 1 from public.tournament_team_availability_slots as availability
            where availability.team_id = candidate.swap_team_a_id
          ) as swap_a_has_availability,
          exists (
            select 1 from public.tournament_team_availability_slots as availability
            where availability.team_id = candidate.swap_team_a_id
              and availability.play_date = target_planning.play_date
              and availability.starts_at = target_planning.starts_at
              and availability.ends_at = target_planning.ends_at
          ) as swap_a_declared_available,
          exists (
            select 1 from public.tournament_team_availability_slots as availability
            where availability.team_id = candidate.swap_team_b_id
          ) as swap_b_has_availability,
          exists (
            select 1 from public.tournament_team_availability_slots as availability
            where availability.team_id = candidate.swap_team_b_id
              and availability.play_date = target_planning.play_date
              and availability.starts_at = target_planning.starts_at
              and availability.ends_at = target_planning.ends_at
          ) as swap_b_declared_available
        from swap_candidates as candidate
        where candidate.absolute_starts_at > now()
          and not exists (
            select 1
            from public.tournament_matches as third_match
            join public.tournament_match_planning as third_planning
              on third_planning.match_id = third_match.id
            where third_match.tournament_id = target_tournament.id
              and third_match.id not in (target_match.id, candidate.swap_match_id)
              and (
                requester_team_id in (third_match.team_a_id, third_match.team_b_id)
                or opponent_team_id in (third_match.team_a_id, third_match.team_b_id)
              )
              and third_planning.play_date = candidate.play_date
              and third_planning.starts_at < candidate.ends_at
              and third_planning.ends_at > candidate.starts_at
          )
          and not exists (
            select 1
            from public.tournament_matches as third_match
            join public.tournament_match_planning as third_planning
              on third_planning.match_id = third_match.id
            where third_match.tournament_id = target_tournament.id
              and third_match.id not in (target_match.id, candidate.swap_match_id)
              and (
                candidate.swap_team_a_id in (third_match.team_a_id, third_match.team_b_id)
                or candidate.swap_team_b_id in (third_match.team_a_id, third_match.team_b_id)
              )
              and third_planning.play_date = target_planning.play_date
              and third_planning.starts_at < target_planning.ends_at
              and third_planning.ends_at > target_planning.starts_at
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
                from public.tournament_match_events as affected_link
                join public.event_resources as event_resource
                  on event_resource.event_id = affected_link.event_id
                where affected_link.match_id in (target_match.id, candidate.swap_match_id)
                  and event_resource.calendar_occupation_id is not null
              )
          )
          and not exists (
            select 1
            from public.calendar_occupations as occupation
            where occupation.resource_id = target_planning.resource_id
              and occupation.cancelled_at is null
              and occupation.starts_at < public.tournament_planning_starts_at(
                target_planning.play_date,
                target_planning.ends_at,
                target_resource.timezone
              )
              and occupation.ends_at > public.tournament_planning_starts_at(
                target_planning.play_date,
                target_planning.starts_at,
                target_resource.timezone
              )
              and occupation.id not in (
                select event_resource.calendar_occupation_id
                from public.tournament_match_events as affected_link
                join public.event_resources as event_resource
                  on event_resource.event_id = affected_link.event_id
                where affected_link.match_id in (target_match.id, candidate.swap_match_id)
                  and event_resource.calendar_occupation_id is not null
              )
          )
      ),
      eligible as (
        select
          measured.*,
          greatest(
            measured.requester_target_other_matches
              - measured.requester_original_other_matches,
            0
          ) as requester_day_penalty,
          measured.requester_has_availability
            and not measured.requester_declared_available
            as requester_outside_declared_availability
        from measured
        where measured.opponent_target_other_matches
              <= measured.opponent_original_other_matches
          and measured.swap_a_target_other_matches
              <= measured.swap_a_original_other_matches
          and measured.swap_b_target_other_matches
              <= measured.swap_b_original_other_matches
          and (
            not measured.opponent_has_availability
            or measured.opponent_declared_available
          )
          and (
            not measured.swap_a_has_availability
            or measured.swap_a_declared_available
          )
          and (
            not measured.swap_b_has_availability
            or measured.swap_b_declared_available
          )
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'kind', 'swap',
            'swap_match_id', eligible.swap_match_id,
            'swap_team_a_id', eligible.swap_team_a_id,
            'swap_team_b_id', eligible.swap_team_b_id,
            'swap_team_a_label', eligible.swap_team_a_label,
            'swap_team_b_label', eligible.swap_team_b_label,
            'resource_id', eligible.resource_id,
            'resource_name', eligible.resource_name,
            'play_date', eligible.play_date,
            'starts_at', eligible.starts_at,
            'ends_at', eligible.ends_at,
            'swap_moves_to_resource_id', target_planning.resource_id,
            'swap_moves_to_resource_name', target_resource.name,
            'swap_moves_to_play_date', target_planning.play_date,
            'swap_moves_to_starts_at', target_planning.starts_at,
            'swap_moves_to_ends_at', target_planning.ends_at,
            'requester_same_day_penalty', eligible.requester_day_penalty,
            'requester_outside_declared_availability',
              eligible.requester_outside_declared_availability,
            'preference', case
              when eligible.requester_day_penalty = 0
                and not eligible.requester_outside_declared_availability
                then 'recommended'
              else 'requester_compromise'
            end
          )
          order by
            eligible.requester_outside_declared_availability,
            eligible.requester_day_penalty,
            abs(eligible.play_date - target_planning.play_date),
            abs(extract(epoch from (eligible.starts_at - target_planning.starts_at))),
            eligible.play_date,
            eligible.starts_at,
            eligible.resource_name,
            eligible.swap_match_id
        ),
        '[]'::jsonb
      )
      from eligible
    )
  );
end;
$$;

revoke all on function public.get_my_tournament_reschedule_options(uuid, uuid)
from public, anon;
grant execute on function public.get_my_tournament_reschedule_options(uuid, uuid)
to authenticated;

commit;
