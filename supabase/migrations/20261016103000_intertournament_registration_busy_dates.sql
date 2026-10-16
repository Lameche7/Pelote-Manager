-- Date-only conflicts across other Pilotoki tournaments for globally identified players.
-- No opponent, venue, or match data leaves this RPC.
create or replace function public.tournament_registration_busy_dates(
  target_tournament_id uuid,
  target_partner_member_id uuid default null
)
returns table(play_date date)
language sql stable security definer
set search_path = ''
as $$
  with target as (
    select t.id,t.club_id,t.starts_on,t.ends_on
    from public.tournaments t
    where t.id=target_tournament_id and auth.uid() is not null
  ), actor as (
    select p.sport_player_id
    from public.profiles p
    where p.id=auth.uid()
  ), partner as (
    select cm.sport_player_id
    from public.club_members cm
    join target t on t.club_id=cm.club_id
    where cm.id=target_partner_member_id and cm.is_active
  ), identified as (
    select sport_player_id from actor where sport_player_id is not null
    union
    select sport_player_id from partner where sport_player_id is not null
  )
  select distinct plan.play_date
  from public.tournament_match_planning plan
  join public.tournament_matches m on m.id=plan.match_id
  join public.tournaments origin on origin.id=m.tournament_id
  join target dest on true
  where origin.id<>dest.id
    and plan.play_date between dest.starts_on and dest.ends_on
    and exists (
      select 1
      from public.tournament_team_players tp
      join public.club_members cm on cm.id=tp.member_id
      join identified i on i.sport_player_id=cm.sport_player_id
      where tp.team_id in (m.team_a_id,m.team_b_id)
    )
  order by plan.play_date;
$$;
revoke all on function public.tournament_registration_busy_dates(uuid,uuid) from public, anon;
grant execute on function public.tournament_registration_busy_dates(uuid,uuid) to authenticated;
