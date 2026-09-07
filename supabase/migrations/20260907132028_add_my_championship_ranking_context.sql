create or replace function public.get_my_championship_ranking_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select distinct
      championship.id as championship_id,
      division.id as division_id,
      division.name as division_name,
      team.id as my_team_id,
      team.pool_id as my_pool_id
    from public.championship_players as player
    join public.championship_team_players as team_player on team_player.player_id = player.id
    join public.championship_teams as team on team.id = team_player.team_id
    join public.championship_divisions as division on division.id = team.division_id
    join public.championships as championship on championship.id = division.championship_id
    where player.profile_id = auth.uid()
      and player.link_status in ('claimed', 'verified')
  ),
  phase_counts as (
    select
      division.id as division_id,
      max(case when match.phase ilike 'Barrage%' then 1 else 0 end) as has_barrage,
      count(distinct case when match.phase ilike 'Barrage%' then match.team1_id end)
        + count(distinct case when match.phase ilike 'Barrage%' then match.team2_id end) as barrage_team_refs,
      max(case
        when match.phase ilike '1/16%' then 32
        when match.phase ilike '1/8%' then 16
        when match.phase ilike '1/4%' then 8
        when match.phase ilike '1/2%' then 4
        when match.phase ilike 'Finale%' then 2
        else 0
      end) as knockout_size
    from public.championship_divisions as division
    left join public.championship_matches as match on match.division_id = division.id
    group by division.id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'championship_id', mine.championship_id,
      'division_id', mine.division_id,
      'division_name', mine.division_name,
      'my_team_id', mine.my_team_id,
      'my_pool_id', mine.my_pool_id,
      'qualification', jsonb_build_object(
        'direct_cutoff', case
          when coalesce(phase_counts.knockout_size, 0) = 0 then null
          when coalesce(phase_counts.has_barrage, 0) = 1
            then greatest(phase_counts.knockout_size - (phase_counts.barrage_team_refs / 2), 0)
          else phase_counts.knockout_size
        end,
        'barrage_start', case
          when coalesce(phase_counts.has_barrage, 0) = 1
            then greatest(phase_counts.knockout_size - (phase_counts.barrage_team_refs / 2), 0) + 1
          else null
        end,
        'barrage_end', case
          when coalesce(phase_counts.has_barrage, 0) = 1
            then greatest(phase_counts.knockout_size - (phase_counts.barrage_team_refs / 2), 0) + phase_counts.barrage_team_refs
          else null
        end,
        'knockout_size', nullif(phase_counts.knockout_size, 0),
        'source', 'official_phases'
      ),
      'pools', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'pool_id', pool.id,
            'pool_code', pool.code,
            'pool_name', pool.name,
            'is_my_pool', pool.id = mine.my_pool_id,
            'standings', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'team_id', team.id,
                  'team_label', team.source_label,
                  'club_name', federation_club.name,
                  'team_number', team.team_number,
                  'official_rank', standing.rank,
                  'official_points', standing.points,
                  'is_my_team', team.id = mine.my_team_id,
                  'played', coalesce(standing.played, 0),
                  'wins', coalesce(standing.wins, 0),
                  'draws', coalesce(standing.draws, 0),
                  'losses', coalesce(standing.losses, 0),
                  'score_for', coalesce(standing.score_for, 0),
                  'score_against', coalesce(standing.score_against, 0),
                  'score_difference', coalesce(standing.score_difference, 0),
                  'has_official_standing', standing.team_id is not null
                ) order by standing.rank nulls last, team.source_label
              ), '[]'::jsonb)
              from public.championship_teams as team
              join public.championship_federation_clubs as federation_club on federation_club.id = team.federation_club_id
              left join public.championship_standings as standing on standing.pool_id = pool.id and standing.team_id = team.id
              where team.pool_id = pool.id
            )
          ) order by
            case when pool.code ~ '^\d+$' then lpad(pool.code, 10, '0') else pool.code end,
            pool.code
        ), '[]'::jsonb)
        from public.championship_pools as pool
        where pool.division_id = mine.division_id
      ),
      'general_standings', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'team_id', team.id,
            'team_label', team.source_label,
            'club_name', federation_club.name,
            'team_number', team.team_number,
            'pool_id', standing.pool_id,
            'pool_code', pool.code,
            'rank', standing.rank,
            'pool_rank', standing.pool_rank,
            'points', standing.points,
            'played', coalesce(standing.played, 0),
            'wins', coalesce(standing.wins, 0),
            'draws', coalesce(standing.draws, 0),
            'losses', coalesce(standing.losses, 0),
            'score_for', coalesce(standing.score_for, 0),
            'score_against', coalesce(standing.score_against, 0),
            'score_difference', coalesce(standing.score_difference, 0),
            'is_my_team', team.id = mine.my_team_id
          ) order by standing.rank
        ), '[]'::jsonb)
        from public.championship_general_standings as standing
        join public.championship_teams as team on team.id = standing.team_id
        join public.championship_federation_clubs as federation_club on federation_club.id = team.federation_club_id
        left join public.championship_pools as pool on pool.id = standing.pool_id
        where standing.division_id = mine.division_id
      )
    ) order by mine.championship_id, mine.division_name
  ), '[]'::jsonb)
  from mine
  left join phase_counts on phase_counts.division_id = mine.division_id;
$$;

revoke all on function public.get_my_championship_ranking_context() from public, anon, authenticated;
grant execute on function public.get_my_championship_ranking_context() to authenticated;
