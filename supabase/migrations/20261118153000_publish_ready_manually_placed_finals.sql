-- After an administrator places a resolved knockout fixture, resume the
-- existing automatic publication workflow for its series.
-- This is deliberately a separate RPC: speculative bracket holds and manual
-- overrides without both teams' declared availability remain unpublished.
begin;

create or replace function public.admin_publish_ready_manual_final(
  target_tournament_id uuid,
  target_series_id uuid,
  target_round_number integer,
  target_display_order integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  selected_club uuid := public.admin_current_club_id();
  selected_match public.tournament_matches;
  selected_plan public.tournament_match_planning;
  selected_tournament public.tournaments;
begin
  if auth.uid() is null
    or selected_club is null
    or not public.has_club_permission(selected_club, 'tournaments.manage')
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select t.* into selected_tournament
  from public.tournaments t
  where t.id = target_tournament_id and t.club_id = selected_club
  for update;
  if not found then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  select m.* into selected_match
  from public.tournament_matches m
  where m.tournament_id = target_tournament_id
    and m.series_id = target_series_id
    and m.phase = 'finals'
    and m.final_round_number = target_round_number
    and m.display_order = target_display_order
  for update;

  -- Only a real match with both actual opponents can enter the publication
  -- pipeline. Never publish a speculative position or finished result.
  if selected_match.id is null
    or selected_match.team_a_id is null
    or selected_match.team_b_id is null
    or exists (
      select 1 from public.tournament_match_results result
      where result.match_id = selected_match.id and result.status = 'validated'
    )
  then
    return false;
  end if;

  if exists (
    select 1 from public.tournament_match_events link
    where link.match_id = selected_match.id
  ) then
    return true;
  end if;

  select p.* into selected_plan
  from public.tournament_match_planning p
  where p.match_id = selected_match.id;

  if selected_plan.match_id is null
    or selected_plan.resource_id is null
    or selected_plan.source is distinct from 'manual'
  then
    return false;
  end if;

  -- This is the exact precondition of the established automatic publisher.
  -- A manual exception without common declared availability is retained as
  -- provisional, with no premature player notification.
  if not exists (
    select 1 from public.tournament_team_availability_slots a
    where a.tournament_id = target_tournament_id
      and a.team_id = selected_match.team_a_id
      and a.play_date = selected_plan.play_date
      and a.starts_at = selected_plan.starts_at
      and a.ends_at = selected_plan.ends_at
  ) or not exists (
    select 1 from public.tournament_team_availability_slots b
    where b.tournament_id = target_tournament_id
      and b.team_id = selected_match.team_b_id
      and b.play_date = selected_plan.play_date
      and b.starts_at = selected_plan.starts_at
      and b.ends_at = selected_plan.ends_at
  ) then
    return false;
  end if;

  if not selected_tournament.finals_auto_advance_enabled then
    return false;
  end if;

  -- Keep the existing protected conflict checks, publication, occupation
  -- syncing, player notifications and deduplication instead of duplicating
  -- those rules in an alternate calendar-specific code path.
  perform public.auto_progress_independent_tournament_final_branches(
    target_tournament_id, target_series_id
  );

  return exists (
    select 1 from public.tournament_match_events link
    where link.match_id = selected_match.id
  );
end;
$function$;

revoke all on function public.admin_publish_ready_manual_final(uuid,uuid,integer,integer)
from public, anon, authenticated;
grant execute on function public.admin_publish_ready_manual_final(uuid,uuid,integer,integer)
to authenticated;

commit;
