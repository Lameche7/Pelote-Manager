begin;

create or replace function public.list_championship_standings_browser(
  target_championship_id uuid
)
returns table (
  division_id uuid,
  division_name text,
  division_display_order integer,
  pool_id uuid,
  pool_code text,
  pool_name text,
  pool_display_order integer,
  team_id uuid,
  team_label text,
  team_number text,
  club_name text,
  players text[],
  standing_rank integer,
  points numeric,
  played integer,
  wins integer,
  draws integer,
  losses integer,
  score_for integer,
  score_against integer,
  score_difference integer,
  has_official_standing boolean,
  is_my_team boolean,
  is_my_division boolean,
  is_my_pool boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with my_teams as (
    select distinct
      team.id as team_id,
      team.division_id,
      team.pool_id
    from public.championship_players as player
    join public.championship_team_players as team_player
      on team_player.player_id = player.id
    join public.championship_teams as team
      on team.id = team_player.team_id
    join public.championship_divisions as division
      on division.id = team.division_id
    where player.profile_id = auth.uid()
      and player.link_status in ('claimed', 'verified')
      and division.championship_id = target_championship_id
  ),
  team_players as (
    select
      team_player.team_id,
      array_agg(
        btrim(concat_ws(' ', player.first_name, player.last_name))
        order by player.last_name, player.first_name
      ) as names
    from public.championship_team_players as team_player
    join public.championship_players as player
      on player.id = team_player.player_id
    group by team_player.team_id
  )
  select
    division.id,
    division.name,
    division.display_order,
    pool.id,
    pool.code,
    pool.name,
    pool.display_order,
    team.id,
    team.source_label,
    team.team_number,
    federation_club.name,
    coalesce(team_players.names, array[]::text[]),
    standing.rank,
    standing.points,
    coalesce(standing.played, 0),
    coalesce(standing.wins, 0),
    coalesce(standing.draws, 0),
    coalesce(standing.losses, 0),
    coalesce(standing.score_for, 0),
    coalesce(standing.score_against, 0),
    coalesce(standing.score_difference, 0),
    standing.team_id is not null,
    exists (
      select 1 from my_teams as mine where mine.team_id = team.id
    ),
    exists (
      select 1 from my_teams as mine where mine.division_id = division.id
    ),
    exists (
      select 1 from my_teams as mine where mine.pool_id = pool.id
    )
  from public.championship_divisions as division
  join public.championship_pools as pool
    on pool.division_id = division.id
  join public.championship_teams as team
    on team.pool_id = pool.id
  join public.championship_federation_clubs as federation_club
    on federation_club.id = team.federation_club_id
  left join public.championship_standings as standing
    on standing.pool_id = pool.id
   and standing.team_id = team.id
  left join team_players
    on team_players.team_id = team.id
  where division.championship_id = target_championship_id
  order by
    division.display_order,
    pool.display_order,
    standing.rank nulls last,
    team.source_label;
$function$;

revoke all on function public.list_championship_standings_browser(uuid)
  from public, anon, authenticated;
grant execute on function public.list_championship_standings_browser(uuid)
  to authenticated;

commit;
