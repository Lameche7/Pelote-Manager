-- Read and edit every linked team independently when a player enters several series.
-- The previous one-team RPCs remain available for legacy registration flows.
create or replace function public.get_my_tournament_finals_availabilities(target_tournament_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $reader$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'team_id', team.id,
      'series_id', team.series_id,
      'series_name', series.name,
      'team_label', public.tournament_team_public_label(team.id),
      'availability_slots', (
        select coalesce(jsonb_agg(
          jsonb_build_object('play_date', slot.play_date, 'starts_at', slot.starts_at, 'ends_at', slot.ends_at)
          order by slot.play_date, slot.starts_at, slot.ends_at
        ), '[]'::jsonb)
        from public.tournament_team_availability_slots slot
        where slot.team_id = team.id and slot.tournament_id = target_tournament_id
      ),
      'player_member_ids', (
        select coalesce(jsonb_agg(distinct player.member_id)
          filter (where player.member_id is not null), '[]'::jsonb)
        from public.tournament_team_players player
        where player.team_id = team.id
      )
    ) order by series.display_order, team.registered_at desc
  ), '[]'::jsonb)
  from public.tournament_teams team
  join public.tournament_series series on series.id = team.series_id
  where team.tournament_id = target_tournament_id
    and team.status in ('pending', 'accepted')
    and auth.uid() is not null
    and public.tournament_profile_is_linked_to_team(team.id, auth.uid());
$reader$;
revoke all on function public.get_my_tournament_finals_availabilities(uuid) from public, anon;
grant execute on function public.get_my_tournament_finals_availabilities(uuid) to authenticated;

create or replace function public.tournament_team_busy_dates_for_team(
  target_tournament_id uuid,
  target_team_id uuid
)
returns table(play_date date, source_title text)
language sql
stable
security definer
set search_path = ''
as $busy$
  with linked_team as (
    select t.id, t.tournament_id, tour.starts_on, tour.ends_on
    from public.tournament_teams t
    join public.tournaments tour on tour.id=t.tournament_id
    where t.id=target_team_id and t.tournament_id=target_tournament_id
      and t.status in ('pending','accepted')
      and auth.uid() is not null
      and public.tournament_profile_is_linked_to_team(t.id,auth.uid())
    order by case when t.status='accepted' then 0 else 1 end,
      t.registered_at desc
    limit 1
  ),
  linked_players as (
    select p.member_id,p.external_identity_id
    from public.tournament_team_players p
    join linked_team t on t.id=p.team_id
  ),
  sport_ids as (
    select cm.sport_player_id as id
    from linked_players lp join public.club_members cm on cm.id=lp.member_id
    where cm.sport_player_id is not null
    union
    select prof.sport_player_id
    from linked_players lp
    join public.tournament_external_player_identities ext
      on ext.id=lp.external_identity_id and ext.status='verified'
    join public.profiles prof on prof.id=ext.profile_id
    where prof.sport_player_id is not null
  ),
  eligible_profiles as (
    select prof.id
    from public.profiles prof
    where exists (
      select 1 from linked_players lp where lp.member_id=prof.member_id
      and lp.member_id is not null
    )
    or prof.sport_player_id in (select id from sport_ids)
    or exists (
      select 1 from linked_players lp
      join public.tournament_external_player_identities ext
        on ext.id=lp.external_identity_id and ext.status='verified'
      where ext.profile_id=prof.id
    )
  ),
  native as (
    select n.play_date, 'Autre tournoi Pilotoki'::text as source_title
    from public.tournament_registration_busy_dates(target_tournament_id,null) n
    where exists(select 1 from linked_team)
    union
    select n.play_date, 'Autre tournoi Pilotoki'::text
    from linked_players lp
    join lateral public.tournament_registration_busy_dates(target_tournament_id,lp.member_id) n
      on lp.member_id is not null
  ),
  imported as (
    select distinct
      (f.value->>'date')::date as play_date,
      ext.title as source_title
    from public.external_errebot_tournaments ext
    join public.external_errebot_participants part on part.tournament_id=ext.id
    join eligible_profiles ep on ep.id=part.profile_id
    cross join lateral jsonb_array_elements(ext.content->'fixtures') f(value)
    join linked_team linked on ext.club_id=(
      select tour.club_id from public.tournaments tour where tour.id=linked.tournament_id
    )
    where part.external_team_id in (
      f.value->>'team1ExternalId', f.value->>'team2ExternalId'
    )
      and coalesce(f.value->>'date','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (f.value->>'date')::date between linked.starts_on and linked.ends_on
      and f.value->>'score1' is null
      and f.value->>'score2' is null
  )
  select distinct conflicts.play_date,conflicts.source_title
  from (select * from native union all select * from imported) conflicts
  order by play_date,source_title;
$busy$;
revoke all on function public.tournament_team_busy_dates_for_team(uuid,uuid) from public, anon;
grant execute on function public.tournament_team_busy_dates_for_team(uuid,uuid) to authenticated;

create or replace function public.tournament_team_busy_date_origins_for_team(target_tournament_id uuid, target_team_id uuid)
returns table(play_date date, blocked_by_self boolean, blocked_by_partner boolean)
language sql stable security definer
set search_path = ''
as $origins$
  with linked_team as (
    select t.id, t.tournament_id, tour.club_id, tour.starts_on, tour.ends_on
    from public.tournament_teams t
    join public.tournaments tour on tour.id = t.tournament_id
    where t.id = target_team_id and t.tournament_id = target_tournament_id
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
revoke all on function public.tournament_team_busy_date_origins_for_team(uuid,uuid) from public, anon;
grant execute on function public.tournament_team_busy_date_origins_for_team(uuid,uuid) to authenticated;

create or replace function public.update_my_tournament_team_finals_availability(
  target_tournament_id uuid,
  target_team_id uuid,
  selected_slots jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_team_id uuid;
  finals_start date;
  finals_end date;
  minimum_finals integer;
  item jsonb;
  count_selected integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select team.id into linked_team_id
  from public.tournament_teams team
  where team.id = target_team_id
    and team.tournament_id = target_tournament_id
    and team.status in ('pending', 'accepted')
    and public.tournament_profile_is_linked_to_team(team.id, auth.uid())
  order by case when team.status = 'accepted' then 0 else 1 end,
           team.registered_at desc
  limit 1;

  if linked_team_id is null then
    raise exception 'No linked active tournament team' using errcode = '42501';
  end if;

  select t.finals_starts_on, t.finals_ends_on, t.minimum_finals_availability_slots
    into finals_start, finals_end, minimum_finals
    from public.tournaments t where t.id = target_tournament_id
    for update;
  if finals_start is null or finals_end is null then
    raise exception 'Tournament finals are not configured' using errcode = '22023';
  end if;
  if jsonb_typeof(selected_slots) is distinct from 'array' then
    raise exception 'Tournament availability slots are invalid' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(selected_slots)
  loop
    if coalesce(item->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(item->>'starts_at', '') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
      or coalesce(item->>'ends_at', '') !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
      or (item->>'date')::date not between finals_start and finals_end
      or not exists (
        select 1
        from public.tournament_generated_slots(target_tournament_id) slot
        where slot.phase = 'finals'
          and slot.play_date = (item->>'date')::date
          and slot.starts_at = (item->>'starts_at')::time
          and slot.ends_at = (item->>'ends_at')::time
      ) then
      raise exception 'Tournament availability slots are invalid' using errcode = '22023';
    end if;
    count_selected := count_selected + 1;
  end loop;
  if count_selected <> (
    select count(distinct concat(value->>'date','|',value->>'starts_at','|',value->>'ends_at'))
    from jsonb_array_elements(selected_slots)
  ) then
    raise exception 'Duplicate tournament availability slots' using errcode = '22023';
  end if;
  if count_selected < coalesce(minimum_finals, 0) then
    raise exception 'Tournament finals availability minimum not reached' using errcode = '22023';
  end if;

  -- Do not retain or add availability on any day with a fixture in another
  -- native or imported tournament. A teammate's conflict blocks the full date.
  if exists (
    select 1 from jsonb_array_elements(selected_slots) candidate
    join public.tournament_team_busy_dates_for_team(target_tournament_id, linked_team_id) busy
      on busy.play_date = (candidate->>'date')::date
  ) then
    raise exception 'Tournament cross-event busy date' using errcode = '22023';
  end if;

  -- Never alter pool availability, or out-of-window selections kept when dates changed.
  delete from public.tournament_team_availability_slots a
  where a.team_id = linked_team_id
    and a.tournament_id = target_tournament_id
    and a.play_date between finals_start and finals_end
    and exists (
      select 1 from public.tournament_generated_slots(target_tournament_id) generated
      where generated.phase = 'finals'
        and generated.play_date = a.play_date
        and generated.starts_at = a.starts_at
        and generated.ends_at = a.ends_at
    );

  insert into public.tournament_team_availability_slots
    (team_id, tournament_id, play_date, starts_at, ends_at)
  select linked_team_id, target_tournament_id,
         (value->>'date')::date, (value->>'starts_at')::time, (value->>'ends_at')::time
  from jsonb_array_elements(selected_slots)
  on conflict (team_id, play_date, starts_at, ends_at) do nothing;

  perform public.assert_tournament_team_finals_availability(linked_team_id);

  insert into public.tournament_audit_log
    (tournament_id, action, payload, created_by)
  values (target_tournament_id, 'finals_availability_updated_by_player',
          jsonb_build_object('team_id', linked_team_id, 'slot_count', count_selected),
          auth.uid());
end;
$$;
revoke all on function public.update_my_tournament_team_finals_availability(uuid,uuid,jsonb) from public, anon;
grant execute on function public.update_my_tournament_team_finals_availability(uuid,uuid,jsonb) to authenticated;
