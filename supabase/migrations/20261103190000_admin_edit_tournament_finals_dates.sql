-- Allow club administrators to set or adjust finals dates after pool generation.
-- Existing scheduled fixtures, planning nodes and chosen team availability are preserved.
create or replace function public.admin_set_tournament_finals_dates(
  target_tournament_id uuid,
  target_finals_starts_on date,
  target_finals_ends_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  previous_dates jsonb;
begin
  if auth.uid() is null
    or target_club_id is null
    or not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
    into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status in ('completed', 'archived', 'cancelled') then
    raise exception 'Tournament finals dates are locked at this stage' using errcode = 'P0001';
  end if;

  if target_finals_starts_on is null
    or target_finals_ends_on is null
    or target_finals_starts_on <= target_tournament.pool_ends_on
    or target_finals_ends_on < target_finals_starts_on then
    raise exception 'Tournament phase dates are invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.club_seasons as season
    where season.id = target_tournament.season_id
      and season.club_id = target_club_id
      and season.starts_on <= target_tournament.pool_starts_on
      and season.ends_on >= target_finals_ends_on
  ) then
    raise exception 'Tournament must fit inside its season' using errcode = '22023';
  end if;

  -- Never silently move or invalidate already planned finals.
  if exists (
    select 1
    from public.tournament_final_planning_nodes as node
    where node.tournament_id = target_tournament_id
      and node.play_date is not null
      and node.play_date not between target_finals_starts_on and target_finals_ends_on
  ) or exists (
    select 1
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    where match.tournament_id = target_tournament_id
      and match.phase = 'finals'
      and planning.play_date not between target_finals_starts_on and target_finals_ends_on
  ) then
    raise exception 'Tournament finals dates conflict with existing planning' using errcode = '22023';
  end if;

  -- Preserve availability already submitted by registered teams.
  if exists (
    select 1
    from public.tournament_team_availability_slots as slot
    join public.tournament_teams as team on team.id = slot.team_id
    where team.tournament_id = target_tournament_id
      and team.status in ('pending', 'accepted')
      and slot.play_date > target_tournament.pool_ends_on
      and slot.play_date not between target_finals_starts_on and target_finals_ends_on
  ) then
    raise exception 'Tournament finals dates conflict with existing availability' using errcode = '22023';
  end if;

  previous_dates := jsonb_build_object(
    'finals_starts_on', target_tournament.finals_starts_on,
    'finals_ends_on', target_tournament.finals_ends_on
  );

  update public.tournaments
  set finals_starts_on = target_finals_starts_on,
      finals_ends_on = target_finals_ends_on,
      ends_on = target_finals_ends_on,
      updated_at = now(),
      updated_by = auth.uid()
  where id = target_tournament_id;

  insert into public.tournament_audit_log (
    tournament_id, action, before_status, after_status, payload, created_by
  ) values (
    target_tournament_id, 'updated', target_tournament.status, target_tournament.status,
    jsonb_build_object(
      'change', 'finals_dates',
      'before', previous_dates,
      'after', jsonb_build_object(
        'finals_starts_on', target_finals_starts_on,
        'finals_ends_on', target_finals_ends_on
      )
    ),
    auth.uid()
  );
end;
$$;

revoke all on function public.admin_set_tournament_finals_dates(uuid, date, date)
from public, anon, authenticated;
grant execute on function public.admin_set_tournament_finals_dates(uuid, date, date)
to authenticated;
