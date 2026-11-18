begin;

-- Retry a single confirmed match immediately after an admin corrects its slot.
-- All club authorization and publication compatibility checks stay server-side.
create or replace function public.admin_retry_tournament_final_match_publication(
  target_match_id uuid
)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare
  selected_club uuid := public.admin_current_club_id();
  target record;
begin
  if auth.uid() is null or selected_club is null
    or not public.has_club_permission(selected_club,'tournaments.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  select m.tournament_id,m.series_id,m.team_a_id,m.team_b_id,m.phase
  into target
  from public.tournament_matches m
  join public.tournaments t on t.id=m.tournament_id and t.club_id=selected_club
  where m.id=target_match_id and m.phase='finals'
  for update of m;
  if not found then raise exception 'Finals match not found' using errcode='P0002'; end if;
  if target.team_a_id is null or target.team_b_id is null then
    raise exception 'Both teams must be confirmed' using errcode='22023';
  end if;
  if exists(select 1 from public.tournament_match_events link
    where link.match_id=target_match_id) then return true; end if;

  perform public.auto_progress_independent_tournament_final_branches(
    target.tournament_id,target.series_id
  );
  return exists(select 1 from public.tournament_match_events link
    where link.match_id=target_match_id);
end;
$function$;
revoke all on function public.admin_retry_tournament_final_match_publication(uuid)
  from public,anon;
grant execute on function public.admin_retry_tournament_final_match_publication(uuid)
  to authenticated;
commit;
