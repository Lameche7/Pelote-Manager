begin;

create or replace function public.list_championship_match_browser(
  target_championship_id uuid
)
returns table (
  match_id uuid,
  division_id uuid,
  division_name text,
  division_display_order integer,
  pool_id uuid,
  pool_code text,
  pool_name text,
  phase text,
  match_status text,
  theoretical_on date,
  effective_on date,
  effective_time time without time zone,
  schedule_source text,
  venue text,
  team1_id uuid,
  team1_label text,
  team1_club_name text,
  team1_players text[],
  team1_is_my_team boolean,
  team1_is_my_club boolean,
  team2_id uuid,
  team2_label text,
  team2_club_name text,
  team2_players text[],
  team2_is_my_team boolean,
  team2_is_my_club boolean,
  official_score_team1 integer,
  official_score_team2 integer,
  proposed_score_team1 integer,
  proposed_score_team2 integer,
  proposed_by_team_label text,
  displayed_score_team1 integer,
  displayed_score_team2 integer,
  result_source text
)
language sql
stable
security definer
set search_path = ''
as $function$
  with my_clubs as (
    select distinct membership.club_id
    from public.club_memberships as membership
    where membership.profile_id = auth.uid()

    union

    select distinct member.club_id
    from public.profiles as profile
    join public.club_members as member
      on profile.sport_player_id is not null
     and member.sport_player_id = profile.sport_player_id
    where profile.id = auth.uid()
  )
  select
    match.id,
    division.id,
    division.name,
    division.display_order,
    pool.id,
    pool.code,
    pool.name,
    match.phase,
    match.status::text,
    match.scheduled_on,
    coalesce(
      (reservation.starts_at at time zone 'Europe/Paris')::date,
      manual.scheduled_on,
      match.agreement_on,
      match.report_on,
      match.scheduled_on
    ),
    coalesce(
      (reservation.starts_at at time zone 'Europe/Paris')::time,
      manual.scheduled_time,
      match.agreement_time,
      match.report_time,
      match.scheduled_time
    ),
    case
      when reservation.starts_at is not null then 'reservation'
      when manual.scheduled_on is not null then 'manual'
      when match.agreement_on is not null then 'agreement'
      when match.report_on is not null then 'report'
      when match.scheduled_on is not null and match.scheduled_time is not null
        then 'federation'
      when match.scheduled_on is not null then 'theoretical'
      else 'unknown'
    end,
    coalesce(
      reservation.resource_name,
      nullif(btrim(manual.venue), ''),
      nullif(btrim(match.agreement_venue), ''),
      nullif(btrim(match.venue), '')
    ),
    team1.id,
    team1.source_label,
    club1.name,
    coalesce(
      (
        select array_agg(
          btrim(concat_ws(' ', player.first_name, player.last_name))
          order by player.last_name, player.first_name
        )
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where team_player.team_id = team1.id
      ),
      array[]::text[]
    ),
    exists (
      select 1
      from public.championship_team_players as mine_team_player
      join public.championship_players as mine_player
        on mine_player.id = mine_team_player.player_id
      where mine_team_player.team_id = team1.id
        and mine_player.profile_id = auth.uid()
        and mine_player.link_status in ('claimed', 'verified')
    ),
    club1.linked_club_id in (select my_clubs.club_id from my_clubs),
    team2.id,
    team2.source_label,
    club2.name,
    coalesce(
      (
        select array_agg(
          btrim(concat_ws(' ', player.first_name, player.last_name))
          order by player.last_name, player.first_name
        )
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where team_player.team_id = team2.id
      ),
      array[]::text[]
    ),
    exists (
      select 1
      from public.championship_team_players as mine_team_player
      join public.championship_players as mine_player
        on mine_player.id = mine_team_player.player_id
      where mine_team_player.team_id = team2.id
        and mine_player.profile_id = auth.uid()
        and mine_player.link_status in ('claimed', 'verified')
    ),
    club2.linked_club_id in (select my_clubs.club_id from my_clubs),
    match.score_team1,
    match.score_team2,
    proposal.score_team1,
    proposal.score_team2,
    proposal_team.source_label,
    coalesce(match.score_team1, proposal.score_team1),
    coalesce(match.score_team2, proposal.score_team2),
    case
      when match.score_team1 is not null and match.score_team2 is not null
        then 'official'
      when proposal.id is not null then 'proposed'
      else 'none'
    end
  from public.championship_matches as match
  join public.championship_divisions as division
    on division.id = match.division_id
  left join public.championship_pools as pool
    on pool.id = match.pool_id
  join public.championship_teams as team1
    on team1.id = match.team1_id
  join public.championship_teams as team2
    on team2.id = match.team2_id
  join public.championship_federation_clubs as club1
    on club1.id = team1.federation_club_id
  join public.championship_federation_clubs as club2
    on club2.id = team2.federation_club_id
  left join public.championship_match_manual_schedules as manual
    on manual.match_id = match.id
  left join lateral (
    select
      reservation.starts_at,
      resource.name as resource_name
    from public.reservations as reservation
    join public.reservable_resources as resource
      on resource.id = reservation.resource_id
    where reservation.championship_match_id = match.id
      and reservation.status in ('pending', 'confirmed')
    order by reservation.starts_at
    limit 1
  ) as reservation on true
  left join lateral (
    select submission.*
    from public.championship_result_submissions as submission
    where submission.match_id = match.id
      and submission.status = 'pending'
    order by submission.created_at desc
    limit 1
  ) as proposal on true
  left join public.championship_teams as proposal_team
    on proposal_team.id = proposal.team_id
  where auth.uid() is not null
    and division.championship_id = target_championship_id
  order by
    coalesce(
      (reservation.starts_at at time zone 'Europe/Paris')::date,
      manual.scheduled_on,
      match.agreement_on,
      match.report_on,
      match.scheduled_on
    ),
    coalesce(
      (reservation.starts_at at time zone 'Europe/Paris')::time,
      manual.scheduled_time,
      match.agreement_time,
      match.report_time,
      match.scheduled_time
    ) nulls last,
    division.display_order,
    pool.display_order,
    match.id;
$function$;

revoke all on function public.list_championship_match_browser(uuid)
  from public, anon, authenticated;
grant execute on function public.list_championship_match_browser(uuid)
  to authenticated;

commit;
