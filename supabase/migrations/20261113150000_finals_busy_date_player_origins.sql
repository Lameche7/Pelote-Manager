-- Explain which member of the linked team causes a cross-tournament busy date.
-- Read-only complement to tournament_team_busy_dates: the latter remains the
-- authority for blocked dates, including conflicts that cannot be attributed.
create or replace function public.tournament_team_busy_date_origins(target_tournament_id uuid)
returns table(play_date date, blocked_by_self boolean, blocked_by_partner boolean)
language sql stable security definer
set search_path = ''
as $origins$
  with linked_team as (
    select t.id, t.tournament_id, tour.club_id, tour.starts_on, tour.ends_on
    from public.tournament_teams t
    join public.tournaments tour on tour.id = t.tournament_id
    where t.tournament_id = target_tournament_id
      and t.status in ('pending', 'accepted')
      and auth.uid() is not null
      and public.tournament_profile_is_linked_to_team(t.id, auth.uid())
    order by case when t.status = 'accepted' then 0 else 1 end,
      t.registered_at desc
    limit 1
  ),
  actor as (
    select p.member_id, p.sport_player_id
    from public.profiles p where p.id = auth.uid()
  ),
  players as (
    select p.member_id, p.external_identity_id,
      coalesce(cm.sport_player_id, ep.sport_player_id) as sport_player_id,
      (
        (p.member_id is not null and p.member_id = (select member_id from actor))
        or (coalesce(cm.sport_player_id, ep.sport_player_id) is not null
            and coalesce(cm.sport_player_id, ep.sport_player_id) = (select sport_player_id from actor))
        or ep.id = auth.uid()
      ) as is_self
    from public.tournament_team_players p
    join linked_team t on t.id = p.team_id
    left join public.club_members cm on cm.id = p.member_id
    left join public.tournament_external_player_identities ext
      on ext.id = p.external_identity_id and ext.status = 'verified'
    left join public.profiles ep on ep.id = ext.profile_id
  ),
  native_conflicts as (
    select distinct plan.play_date, players.is_self
    from players
    join public.tournament_team_players other_player on true
    left join public.club_members other_member on other_member.id = other_player.member_id
    left join public.tournament_external_player_identities other_ext
      on other_ext.id = other_player.external_identity_id and other_ext.status = 'verified'
    left join public.profiles other_profile on other_profile.id = other_ext.profile_id
    join public.tournament_matches m
      on other_player.team_id in (m.team_a_id, m.team_b_id)
    join public.tournament_match_planning plan on plan.match_id = m.id
    join linked_team t on true
    where players.sport_player_id is not null
      and players.sport_player_id = coalesce(other_member.sport_player_id, other_profile.sport_player_id)
      and m.tournament_id <> t.tournament_id
      and plan.play_date between t.starts_on and t.ends_on
  ),
  imported_conflicts as (
    select distinct (fixture.value->>'date')::date as play_date, players.is_self
    from players
    join public.profiles profile on
      (players.member_id is not null and profile.member_id = players.member_id)
      or (players.sport_player_id is not null
          and profile.sport_player_id = players.sport_player_id)
      or exists (
        select 1 from public.tournament_external_player_identities ext
        where ext.id = players.external_identity_id
          and ext.status = 'verified' and ext.profile_id = profile.id
      )
    join public.external_errebot_participants participant on participant.profile_id = profile.id
    join public.external_errebot_tournaments tournament
      on tournament.id = participant.tournament_id
    join linked_team t on t.club_id = tournament.club_id
    cross join lateral jsonb_array_elements(tournament.content->'fixtures') fixture(value)
    where participant.external_team_id in (
        fixture.value->>'team1ExternalId', fixture.value->>'team2ExternalId'
      )
      and coalesce(fixture.value->>'date','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (fixture.value->>'date')::date between t.starts_on and t.ends_on
      and fixture.value->>'score1' is null
      and fixture.value->>'score2' is null
  ),
  conflicts as (
    select * from native_conflicts
    union all
    select * from imported_conflicts
  )
  select conflicts.play_date,
    bool_or(conflicts.is_self) as blocked_by_self,
    bool_or(not conflicts.is_self) as blocked_by_partner
  from conflicts
  group by conflicts.play_date
  order by conflicts.play_date;
$origins$;
revoke all on function public.tournament_team_busy_date_origins(uuid) from public, anon;
grant execute on function public.tournament_team_busy_date_origins(uuid) to authenticated;
