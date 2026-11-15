-- Permit an authorized tournament admin to assign one finals position to an
-- exceptional date/time, without modifying the tournament's configured slots.
-- Explicit/manual action only; never called by the automatic scheduler.
create or replace function public.admin_set_tournament_final_manual_datetime(
  target_tournament_id uuid,
  target_series_id uuid,
  target_round_number integer,
  target_display_order integer,
  target_resource_id uuid,
  target_play_date date,
  target_starts_at time without time zone,
  target_ends_at time without time zone
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_club uuid := public.admin_current_club_id();
  selected_tournament public.tournaments;
  selected_node public.tournament_final_planning_nodes;
  selected_match public.tournament_matches;
  selected_timezone text;
  from_instant timestamptz;
  until_instant timestamptz;
begin
  if auth.uid() is null
    or not public.has_club_permission(selected_club, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select t.* into selected_tournament
  from public.tournaments t
  where t.id = target_tournament_id and t.club_id = selected_club
  for update;
  if selected_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  select n.* into selected_node
  from public.tournament_final_planning_nodes n
  where n.tournament_id = target_tournament_id
    and n.series_id = target_series_id
    and n.round_number = target_round_number
    and n.display_order = target_display_order
  for update;
  if selected_node.tournament_id is null then
    raise exception 'Finals position not found' using errcode = 'P0002';
  end if;

  select m.* into selected_match
  from public.tournament_matches m
  where m.tournament_id = target_tournament_id
    and m.series_id = target_series_id
    and m.phase = 'finals'
    and m.final_round_number = target_round_number
    and m.display_order = target_display_order;

  if selected_match.id is not null and (
    exists(select 1 from public.tournament_match_events e
      where e.match_id = selected_match.id)
    or exists(select 1 from public.tournament_match_results r
      where r.match_id = selected_match.id and r.status = 'validated')
  ) then
    raise exception 'Published or completed match cannot be moved'
      using errcode = 'P0001';
  end if;

  if target_play_date is null
    or selected_tournament.finals_starts_on is null
    or selected_tournament.finals_ends_on is null
    or target_play_date < selected_tournament.finals_starts_on
    or target_play_date > selected_tournament.finals_ends_on
    or target_starts_at is null
    or target_ends_at is null
    or target_ends_at <= target_starts_at
    or target_ends_at - target_starts_at < interval '30 minutes'
    or target_ends_at - target_starts_at > interval '5 hours' then
    raise exception 'Date outside final stage or invalid duration'
      using errcode = '22023';
  end if;

  select coalesce(rr.timezone, 'Europe/Paris')
  into selected_timezone
  from public.reservable_resources rr
  join public.tournament_resources tr
    on tr.resource_id = rr.id
  where rr.id = target_resource_id
    and tr.tournament_id = target_tournament_id
    and rr.club_id = selected_club;
  if selected_timezone is null then
    raise exception 'Resource is not part of this tournament'
      using errcode = '22023';
  end if;

  from_instant := timezone(selected_timezone, target_play_date + target_starts_at);
  until_instant := timezone(selected_timezone, target_play_date + target_ends_at);

  -- A provisional bracket position also reserves its court, even when the
  -- teams in a future round are still unknown.
  if exists (
    select 1 from public.tournament_final_planning_nodes n
    where n.resource_id = target_resource_id
      and n.play_date = target_play_date
      and n.starts_at < target_ends_at
      and n.ends_at > target_starts_at
      and not (
        n.tournament_id = target_tournament_id
        and n.series_id = target_series_id
        and n.round_number = target_round_number
        and n.display_order = target_display_order
      )
  ) then
    raise exception 'Court occupied by another finals position'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.tournament_match_planning mp
    where mp.resource_id = target_resource_id
      and mp.play_date = target_play_date
      and mp.starts_at < target_ends_at
      and mp.ends_at > target_starts_at
      and (selected_match.id is null or mp.match_id <> selected_match.id)
  ) then
    raise exception 'Court occupied by another tournament match'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.reservations r
    where r.resource_id = target_resource_id
      and r.status::text in ('pending', 'confirmed', 'completed')
      and r.starts_at < until_instant
      and r.ends_at > from_instant
  ) then
    raise exception 'Court occupied by an existing reservation'
      using errcode = 'P0001';
  end if;

  -- Includes published championships, closures and other event blocks,
  -- not just ordinary user reservations.
  if exists (
    select 1 from public.calendar_occupations o
    where o.resource_id = target_resource_id
      and o.cancelled_at is null
      and o.starts_at < until_instant
      and o.ends_at > from_instant
  ) then
    raise exception 'Court occupied by another calendar event'
      using errcode = 'P0001';
  end if;

  -- No future round may start before the preceding round is finished.
  if exists (
    select 1 from public.tournament_final_planning_nodes n
    where n.tournament_id = target_tournament_id
      and n.series_id = target_series_id
      and n.resource_id is not null
      and n.round_number <> target_round_number
      and (
        (n.round_number < target_round_number
          and n.play_date + n.ends_at > target_play_date + target_starts_at)
        or
        (n.round_number > target_round_number
          and n.play_date + n.starts_at < target_play_date + target_ends_at)
      )
  ) then
    raise exception 'Date conflicts with the order of knockout rounds'
      using errcode = 'P0001';
  end if;

  update public.tournament_final_planning_nodes n
  set resource_id = target_resource_id,
      play_date = target_play_date,
      starts_at = target_starts_at,
      ends_at = target_ends_at,
      source = 'manual',
      updated_at = now()
  where n.tournament_id = target_tournament_id
    and n.series_id = target_series_id
    and n.round_number = target_round_number
    and n.display_order = target_display_order;

  if selected_match.id is not null then
    perform public.sync_tournament_final_planning_node_to_match(selected_match.id);
  end if;

  insert into public.tournament_audit_log (
    tournament_id, action, before_status, after_status, payload, created_by
  ) values (
    target_tournament_id,
    'final_stage_exceptional_manual_slot',
    selected_tournament.status, selected_tournament.status,
    jsonb_build_object(
      'series_id', target_series_id,
      'round_number', target_round_number,
      'display_order', target_display_order,
      'resource_id', target_resource_id,
      'play_date', target_play_date,
      'starts_at', target_starts_at,
      'ends_at', target_ends_at
    ),
    auth.uid()
  );
end;
$function$;

revoke all on function public.admin_set_tournament_final_manual_datetime(
  uuid,uuid,integer,integer,uuid,date,time,time
) from public,anon,authenticated;
grant execute on function public.admin_set_tournament_final_manual_datetime(
  uuid,uuid,integer,integer,uuid,date,time,time
) to authenticated;
