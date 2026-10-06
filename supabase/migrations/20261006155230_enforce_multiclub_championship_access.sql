begin;

create or replace function public.championship_profile_can_act_for_team(
  target_team_id uuid,
  target_profile_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_profile_id is not null and exists (
    select 1
    from public.championship_teams as team
    join public.championship_divisions as division on division.id = team.division_id
    join public.championships as championship on championship.id = division.championship_id
    join public.championship_federation_clubs as federation_club on federation_club.id = team.federation_club_id
    join public.championship_club_links as club_link
      on club_link.championship_id = championship.id
     and club_link.federation_club_id = federation_club.id
     and club_link.club_id = federation_club.linked_club_id
    where team.id = target_team_id
      and federation_club.linked_club_id is not null
      and public.is_active_licensee_for_club(
        target_profile_id,
        federation_club.linked_club_id,
        current_date
      )
      and exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player on player.id = team_player.player_id
        where team_player.team_id = team.id
          and player.profile_id = target_profile_id
          and player.link_status in ('claimed', 'verified')
      )
  );
$$;

revoke all on function public.championship_profile_can_act_for_team(uuid,uuid)
from public, anon, authenticated;
grant execute on function public.championship_profile_can_act_for_team(uuid,uuid)
to authenticated;

create or replace function public.championship_reservation_player_is_eligible(
  target_club_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null and exists (
    select 1
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    where federation_club.linked_club_id = target_club_id
      and public.championship_profile_can_act_for_team(team.id, target_user_id)
  );
$$;

create or replace function public.get_my_championship_match_reservations()
returns table(
  match_id uuid,
  reservation_id uuid,
  resource_id uuid,
  resource_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    reservation.championship_match_id,
    reservation.id,
    reservation.resource_id,
    resource.name,
    reservation.starts_at,
    reservation.ends_at,
    reservation.status::text
  from public.reservations as reservation
  join public.reservable_resources as resource on resource.id = reservation.resource_id
  join public.championship_matches as match on match.id = reservation.championship_match_id
  where reservation.championship_match_id is not null
    and reservation.status in ('pending', 'confirmed')
    and (
      public.championship_profile_can_act_for_team(match.team1_id, auth.uid())
      or public.championship_profile_can_act_for_team(match.team2_id, auth.uid())
    )
  order by reservation.starts_at;
$$;

create or replace function public.get_my_championship_manual_schedules()
returns table(match_id uuid, scheduled_on date, scheduled_time time, venue text)
language sql
stable
security definer
set search_path = ''
as $$
  select schedule.match_id, schedule.scheduled_on, schedule.scheduled_time, schedule.venue
  from public.championship_match_manual_schedules as schedule
  join public.championship_matches as match on match.id = schedule.match_id
  where public.championship_profile_can_act_for_team(match.team1_id, auth.uid())
     or public.championship_profile_can_act_for_team(match.team2_id, auth.uid());
$$;

create or replace function public.get_my_championship_result_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select distinct championship.id
    from public.championship_teams as team
    join public.championship_divisions as division on division.id = team.division_id
    join public.championships as championship on championship.id = division.championship_id
    where public.championship_profile_can_act_for_team(team.id, auth.uid())
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'championship_id', championship.id,
        'input_mode', championship.result_input_mode,
        'winning_score', championship.result_winning_score
      ) order by championship.id
    ),
    '[]'::jsonb
  )
  from mine
  join public.championships as championship on championship.id = mine.id;
$$;

create or replace function public.get_my_championship_result_submissions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with my_match_teams as (
    select distinct match.id as match_id, team.id as team_id, match.team1_id, match.team2_id
    from public.championship_matches as match
    join public.championship_teams as team on team.id in (match.team1_id, match.team2_id)
    where public.championship_profile_can_act_for_team(team.id, auth.uid())
  ),
  latest as (
    select distinct on (submission.match_id, submission.team_id) submission.*
    from public.championship_result_submissions as submission
    join my_match_teams as mine
      on mine.match_id = submission.match_id
     and mine.team_id = submission.team_id
    where submission.status <> 'withdrawn'
    order by submission.match_id, submission.team_id, submission.created_at desc, submission.id desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', submission.id,
        'match_id', submission.match_id,
        'team_id', submission.team_id,
        'score_mine', case when submission.team_id = mine.team1_id then submission.score_team1 else submission.score_team2 end,
        'score_opponent', case when submission.team_id = mine.team1_id then submission.score_team2 else submission.score_team1 end,
        'status', submission.status,
        'comment', submission.comment,
        'official_score_mine', case when submission.team_id = mine.team1_id then submission.official_score_team1 else submission.official_score_team2 end,
        'official_score_opponent', case when submission.team_id = mine.team1_id then submission.official_score_team2 else submission.official_score_team1 end,
        'created_at', submission.created_at,
        'resolved_at', submission.resolved_at
      ) order by submission.created_at desc
    ),
    '[]'::jsonb
  )
  from latest as submission
  join my_match_teams as mine
    on mine.match_id = submission.match_id
   and mine.team_id = submission.team_id;
$$;

create or replace function public.get_my_championship_venue_overrides()
returns table(match_id uuid, enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select distinct match.id as match_id, federation_club.linked_club_id as club_id
    from public.championship_matches as match
    join public.championship_teams as my_team on my_team.id = match.team2_id
    join public.championship_federation_clubs as federation_club on federation_club.id = my_team.federation_club_id
    where federation_club.linked_club_id is not null
      and public.championship_profile_can_act_for_team(match.team2_id, auth.uid())
  )
  select mine.match_id, coalesce(venue_override.enabled, false)
  from mine
  left join public.championship_match_club_venue_overrides as venue_override
    on venue_override.match_id = mine.match_id
   and venue_override.club_id = mine.club_id;
$$;

create or replace function public.get_my_championship_player_contacts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with my_teams as (
    select distinct championship.id as championship_id, team.id as team_id
    from public.championship_teams as team
    join public.championship_divisions as division on division.id = team.division_id
    join public.championships as championship on championship.id = division.championship_id
    where public.championship_profile_can_act_for_team(team.id, auth.uid())
      and championship.status in ('preparation', 'active')
  ),
  allowed_teams as (
    select mine.championship_id, mine.team_id from my_teams as mine
    union
    select mine.championship_id,
      case when match.team1_id = mine.team_id then match.team2_id else match.team1_id end
    from my_teams as mine
    join public.championship_teams as own_team on own_team.id = mine.team_id
    join public.championship_matches as match
      on match.division_id = own_team.division_id
     and mine.team_id in (match.team1_id, match.team2_id)
    where case when match.team1_id = mine.team_id then match.team2_id else match.team1_id end is not null
  ),
  contacts as (
    select allowed.championship_id, team_player.team_id,
      player.first_name, player.last_name,
      coalesce(profile_contact.phone, sport_contact.phone) as phone
    from allowed_teams as allowed
    join public.championship_team_players as team_player on team_player.team_id = allowed.team_id
    join public.championship_players as player on player.id = team_player.player_id
    left join public.profiles as profile on profile.id = player.profile_id
    left join lateral (
      select nullif(btrim(member.phone), '') as phone
      from public.club_members as member
      where nullif(btrim(member.phone), '') is not null
        and (
          (profile.sport_player_id is not null and member.sport_player_id = profile.sport_player_id)
          or (profile.sport_player_id is null and member.id = profile.member_id)
        )
      order by member.is_active desc, member.updated_at desc, member.id
      limit 1
    ) as profile_contact on true
    left join lateral (
      select nullif(btrim(member.phone), '') as phone
      from public.club_members as member
      where player.sport_player_id is not null
        and member.sport_player_id = player.sport_player_id
        and nullif(btrim(member.phone), '') is not null
      order by member.is_active desc, member.updated_at desc, member.id
      limit 1
    ) as sport_contact on true
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'championship_id', contact.championship_id,
      'team_id', contact.team_id,
      'first_name', contact.first_name,
      'last_name', contact.last_name,
      'phone', contact.phone
    ) order by contact.championship_id, contact.team_id, contact.last_name, contact.first_name)
    filter (where contact.phone is not null),
    '[]'::jsonb
  )
  from contacts as contact;
$$;

create or replace function public.set_my_championship_manual_schedule(
  target_match_id uuid,
  target_scheduled_on date,
  target_scheduled_time time,
  target_venue text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  match_row public.championship_matches%rowtype;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into match_row from public.championship_matches where id=target_match_id;
  if match_row.id is null then raise exception 'Championship match not found' using errcode='P0002'; end if;

  if not (
    public.championship_profile_can_act_for_team(match_row.team1_id, actor_id)
    or public.championship_profile_can_act_for_team(match_row.team2_id, actor_id)
  ) then raise exception 'Forbidden' using errcode='42501'; end if;

  if match_row.status in ('played','forfeit','cancelled')
     or match_row.score_raw is not null
     or match_row.score_team1 is not null
     or match_row.score_team2 is not null
  then raise exception 'Match unavailable' using errcode='22023'; end if;

  insert into public.championship_match_manual_schedules(match_id,scheduled_on,scheduled_time,venue,updated_by,updated_at)
  values(target_match_id,target_scheduled_on,target_scheduled_time,nullif(btrim(target_venue),''),actor_id,now())
  on conflict(match_id) do update
    set scheduled_on=excluded.scheduled_on,
        scheduled_time=excluded.scheduled_time,
        venue=excluded.venue,
        updated_by=actor_id,
        updated_at=now();
end;
$$;

create or replace function public.set_my_championship_home_venue(target_match_id uuid,target_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;

  select federation_club.linked_club_id into target_club_id
  from public.championship_matches as match
  join public.championship_teams as my_team on my_team.id=match.team2_id
  join public.championship_federation_clubs as federation_club on federation_club.id=my_team.federation_club_id
  where match.id=target_match_id
    and federation_club.linked_club_id is not null
    and public.championship_profile_can_act_for_team(match.team2_id,actor_id)
  limit 1;

  if target_club_id is null then
    raise exception 'Cette partie extérieure ne peut pas utiliser un trinquet de votre club' using errcode='42501';
  end if;

  if not target_enabled and exists(
    select 1 from public.reservations
    where championship_match_id=target_match_id and status in ('pending','confirmed')
  ) then
    raise exception 'Annulez d abord la réservation active avant de retirer ce trinquet' using errcode='P0001';
  end if;

  insert into public.championship_match_club_venue_overrides(match_id,club_id,enabled,created_by,updated_at)
  values(target_match_id,target_club_id,target_enabled,actor_id,now())
  on conflict(match_id,club_id) do update set enabled=excluded.enabled,updated_at=now();
end;
$$;

commit;
