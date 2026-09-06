create or replace function public.get_my_championships()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with my_teams as (
    select distinct
      championship.id as championship_id,
      championship.name as championship_name,
      championship.specialty,
      championship.season_label,
      championship.status as championship_status,
      championship.source_url,
      division.id as division_id,
      division.name as division_name,
      pool.id as pool_id,
      pool.code as pool_code,
      pool.name as pool_name,
      team.id as team_id,
      team.source_label as team_label,
      federation_club.name as club_name,
      coalesce(standing.rank, team.source_rank) as official_rank
    from public.championship_players as player
    join public.championship_team_players as team_player
      on team_player.player_id = player.id
    join public.championship_teams as team
      on team.id = team_player.team_id
    join public.championship_divisions as division
      on division.id = team.division_id
    join public.championships as championship
      on championship.id = division.championship_id
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    left join public.championship_pools as pool
      on pool.id = team.pool_id
    left join public.championship_standings as standing
      on standing.pool_id = team.pool_id
     and standing.team_id = team.id
    where player.profile_id = auth.uid()
      and player.link_status in ('claimed', 'verified')
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'championship_id', mine.championship_id,
        'championship_name', mine.championship_name,
        'specialty', mine.specialty,
        'season_label', mine.season_label,
        'championship_status', mine.championship_status,
        'source_url', mine.source_url,
        'division_id', mine.division_id,
        'division_name', mine.division_name,
        'pool_id', mine.pool_id,
        'pool_code', mine.pool_code,
        'pool_name', mine.pool_name,
        'team_id', mine.team_id,
        'team_label', mine.team_label,
        'club_name', mine.club_name,
        'official_rank', mine.official_rank,
        'players', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'first_name', player.first_name,
                'last_name', player.last_name,
                'is_me', player.profile_id = auth.uid()
              )
              order by player.last_name, player.first_name
            ),
            '[]'::jsonb
          )
          from public.championship_team_players as team_player
          join public.championship_players as player
            on player.id = team_player.player_id
          where team_player.team_id = mine.team_id
        ),
        'pool_standings', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'team_id', pool_team.id,
                'team_label', pool_team.source_label,
                'club_name', pool_club.name,
                'team_number', pool_team.team_number,
                'official_rank', coalesce(pool_standing.rank, pool_team.source_rank),
                'is_my_team', pool_team.id = mine.team_id,
                'played', coalesce(stats.played, 0),
                'wins', coalesce(stats.wins, 0),
                'draws', coalesce(stats.draws, 0),
                'losses', coalesce(stats.losses, 0),
                'score_for', coalesce(stats.score_for, 0),
                'score_against', coalesce(stats.score_against, 0),
                'score_difference', coalesce(stats.score_for, 0) - coalesce(stats.score_against, 0)
              )
              order by
                coalesce(pool_standing.rank, pool_team.source_rank) nulls last,
                pool_team.source_label
            ),
            '[]'::jsonb
          )
          from public.championship_teams as pool_team
          join public.championship_federation_clubs as pool_club
            on pool_club.id = pool_team.federation_club_id
          left join public.championship_standings as pool_standing
            on pool_standing.pool_id = pool_team.pool_id
           and pool_standing.team_id = pool_team.id
          left join lateral (
            select
              count(*)::integer as played,
              count(*) filter (
                where (match.team1_id = pool_team.id and match.score_team1 > match.score_team2)
                   or (match.team2_id = pool_team.id and match.score_team2 > match.score_team1)
              )::integer as wins,
              count(*) filter (
                where match.score_team1 = match.score_team2
              )::integer as draws,
              count(*) filter (
                where (match.team1_id = pool_team.id and match.score_team1 < match.score_team2)
                   or (match.team2_id = pool_team.id and match.score_team2 < match.score_team1)
              )::integer as losses,
              coalesce(sum(
                case
                  when match.team1_id = pool_team.id then match.score_team1
                  else match.score_team2
                end
              ), 0)::integer as score_for,
              coalesce(sum(
                case
                  when match.team1_id = pool_team.id then match.score_team2
                  else match.score_team1
                end
              ), 0)::integer as score_against
            from public.championship_matches as match
            where match.pool_id = mine.pool_id
              and pool_team.id in (match.team1_id, match.team2_id)
              and match.score_team1 is not null
              and match.score_team2 is not null
          ) as stats on true
          where mine.pool_id is not null
            and pool_team.pool_id = mine.pool_id
        ),
        'matches', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', match.id,
                'phase', match.phase,
                'pool_code', pool.code,
                'team_side', case when match.team1_id = mine.team_id then 'a' else 'b' end,
                'opponent_team_id', case when match.team1_id = mine.team_id then match.team2_id else match.team1_id end,
                'opponent_label', case when match.team1_id = mine.team_id then opponent2.source_label else opponent1.source_label end,
                'scheduled_on', match.scheduled_on,
                'scheduled_time', match.scheduled_time,
                'report_on', match.report_on,
                'report_time', match.report_time,
                'agreement_on', match.agreement_on,
                'agreement_time', match.agreement_time,
                'venue', match.venue,
                'agreement_venue', match.agreement_venue,
                'status', match.status,
                'score_raw', match.score_raw,
                'score_mine', case when match.team1_id = mine.team_id then match.score_team1 else match.score_team2 end,
                'score_opponent', case when match.team1_id = mine.team_id then match.score_team2 else match.score_team1 end,
                'result_comment', match.result_comment
              )
              order by
                coalesce(match.agreement_on, match.report_on, match.scheduled_on) nulls last,
                coalesce(match.agreement_time, match.report_time, match.scheduled_time) nulls last,
                match.phase,
                match.id
            ),
            '[]'::jsonb
          )
          from public.championship_matches as match
          left join public.championship_pools as pool
            on pool.id = match.pool_id
          left join public.championship_teams as opponent1
            on opponent1.id = match.team1_id
          left join public.championship_teams as opponent2
            on opponent2.id = match.team2_id
          where mine.team_id in (match.team1_id, match.team2_id)
        )
      )
      order by mine.season_label desc, mine.championship_name, mine.division_name
    ),
    '[]'::jsonb
  )
  from my_teams as mine;
$$;

revoke all on function public.get_my_championships() from public, anon, authenticated;
grant execute on function public.get_my_championships() to authenticated;
