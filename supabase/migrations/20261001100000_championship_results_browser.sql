begin;

create or replace function public.list_championship_results_catalog()
returns table (
  championship_id uuid,
  championship_name text,
  specialty text,
  season_label text,
  championship_status text,
  source_url text,
  has_my_team boolean,
  has_my_club_team boolean,
  my_division_ids uuid[],
  divisions jsonb,
  result_count integer
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
    championship.id,
    championship.name,
    championship.specialty,
    championship.season_label,
    championship.status::text,
    championship.source_url,
    exists (
      select 1
      from public.championship_divisions as my_division
      join public.championship_teams as my_team
        on my_team.division_id = my_division.id
      join public.championship_team_players as my_team_player
        on my_team_player.team_id = my_team.id
      join public.championship_players as my_player
        on my_player.id = my_team_player.player_id
      where my_division.championship_id = championship.id
        and my_player.profile_id = auth.uid()
        and my_player.link_status in ('claimed', 'verified')
    ) as has_my_team,
    exists (
      select 1
      from public.championship_divisions as club_division
      join public.championship_teams as club_team
        on club_team.division_id = club_division.id
      join public.championship_federation_clubs as federation_club
        on federation_club.id = club_team.federation_club_id
      where club_division.championship_id = championship.id
        and federation_club.linked_club_id in (
          select my_clubs.club_id from my_clubs
        )
    ) as has_my_club_team,
    coalesce(
      (
        select array_agg(distinct my_division.id order by my_division.id)
        from public.championship_divisions as my_division
        join public.championship_teams as my_team
          on my_team.division_id = my_division.id
        join public.championship_team_players as my_team_player
          on my_team_player.team_id = my_team.id
        join public.championship_players as my_player
          on my_player.id = my_team_player.player_id
        where my_division.championship_id = championship.id
          and my_player.profile_id = auth.uid()
          and my_player.link_status in ('claimed', 'verified')
      ),
      array[]::uuid[]
    ) as my_division_ids,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', division.id,
            'name', division.name,
            'display_order', division.display_order
          )
          order by division.display_order, division.name
        )
        from public.championship_divisions as division
        where division.championship_id = championship.id
      ),
      '[]'::jsonb
    ) as divisions,
    (
      select count(*)::integer
      from public.championship_matches as match
      join public.championship_divisions as result_division
        on result_division.id = match.division_id
      where result_division.championship_id = championship.id
        and (
          (match.score_team1 is not null and match.score_team2 is not null)
          or nullif(btrim(match.score_raw), '') is not null
        )
    ) as result_count
  from public.championships as championship
  where auth.uid() is not null
    and championship.status <> 'preparation'
  order by
    case championship.status::text
      when 'active' then 0
      when 'completed' then 1
      when 'archived' then 2
      else 3
    end,
    championship.season_label desc,
    championship.name,
    championship.specialty;
$function$;

revoke all on function public.list_championship_results_catalog()
  from public, anon, authenticated;
grant execute on function public.list_championship_results_catalog()
  to authenticated;

create or replace function public.list_championship_results(
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
  played_on date,
  played_time time without time zone,
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
  score_team1 integer,
  score_team2 integer,
  score_raw text
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
    coalesce(match.agreement_on, match.report_on, match.scheduled_on),
    coalesce(match.agreement_time, match.report_time, match.scheduled_time),
    coalesce(match.agreement_venue, match.venue),
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
    match.score_raw
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
  where auth.uid() is not null
    and division.championship_id = target_championship_id
    and (
      (match.score_team1 is not null and match.score_team2 is not null)
      or nullif(btrim(match.score_raw), '') is not null
    )
  order by
    coalesce(match.agreement_on, match.report_on, match.scheduled_on) desc nulls last,
    coalesce(match.agreement_time, match.report_time, match.scheduled_time) desc nulls last,
    division.display_order,
    pool.display_order,
    match.id;
$function$;

revoke all on function public.list_championship_results(uuid)
  from public, anon, authenticated;
grant execute on function public.list_championship_results(uuid)
  to authenticated;

commit;
