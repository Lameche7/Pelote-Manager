begin;

-- La page publique d'un tournoi reste sportive dès qu'une compétition a
-- réellement commencé : planning publié, résultat validé ou tableau final
-- généré. Elle expose désormais les poules historiques ET le tableau des
-- phases finales de chaque série.
create or replace function public.get_public_tournament_results(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    return null;
  end if;

  if not (
    target_tournament.status in (
      'planning_published',
      'in_progress',
      'completed',
      'archived'
    )
    or exists (
      select 1
      from public.tournament_matches as match
      join public.tournament_match_events as link on link.match_id = match.id
      join public.events as event on event.id = link.event_id
      where match.tournament_id = target_tournament.id
        and event.publication_status = 'published'
    )
    or exists (
      select 1
      from public.tournament_matches as match
      join public.tournament_match_results as result
        on result.match_id = match.id
       and result.status = 'validated'
      where match.tournament_id = target_tournament.id
    )
    or exists (
      select 1
      from public.tournament_final_seeds as seed
      where seed.tournament_id = target_tournament.id
    )
  ) then
    return null;
  end if;

  return jsonb_build_object(
    'tournament_id', target_tournament.id,
    'tournament_name', target_tournament.name,
    'status', target_tournament.status,
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', series.id,
          'name', series.name,
          'color', series.color,
          'display_order', series.display_order,
          'qualifier_count', series.finals_qualifier_count,
          'finals_generated', exists (
            select 1
            from public.tournament_final_seeds as seed
            where seed.tournament_id = target_tournament.id
              and seed.series_id = series.id
          ),
          'final_seeds', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'seed', seed.seed,
                'team_id', seed.team_id,
                'team_label', public.tournament_team_public_label(seed.team_id)
              )
              order by seed.seed
            )
            from public.tournament_final_seeds as seed
            where seed.tournament_id = target_tournament.id
              and seed.series_id = series.id
          ), '[]'::jsonb),
          'final_matches', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', match.id,
                'round', match.final_round,
                'round_number', match.final_round_number,
                'display_order', match.display_order,
                'seed_a', match.final_seed_a,
                'seed_b', match.final_seed_b,
                'team_a_id', match.team_a_id,
                'team_a_label', public.tournament_team_public_label(match.team_a_id),
                'team_b_id', match.team_b_id,
                'team_b_label', public.tournament_team_public_label(match.team_b_id),
                'published', event.publication_status = 'published',
                'play_date', case
                  when event.publication_status = 'published'
                    or result.status = 'validated'
                    then planning.play_date
                  else null
                end,
                'starts_at', case
                  when event.publication_status = 'published'
                    or result.status = 'validated'
                    then planning.starts_at
                  else null
                end,
                'ends_at', case
                  when event.publication_status = 'published'
                    or result.status = 'validated'
                    then planning.ends_at
                  else null
                end,
                'resource_name', case
                  when event.publication_status = 'published'
                    or result.status = 'validated'
                    then resource.name
                  else null
                end,
                'result_status', result.status,
                'winner_team_id', case
                  when result.status = 'validated' then result.winner_team_id
                  else null
                end,
                'score', case
                  when result.status = 'validated' then result.score
                  else null
                end,
                'team_a_sets', case
                  when result.status = 'validated' then result.team_a_sets
                  else null
                end,
                'team_b_sets', case
                  when result.status = 'validated' then result.team_b_sets
                  else null
                end
              )
              order by match.final_round_number, match.display_order
            )
            from public.tournament_matches as match
            left join public.tournament_match_results as result
              on result.match_id = match.id
            left join public.tournament_match_planning as planning
              on planning.match_id = match.id
            left join public.reservable_resources as resource
              on resource.id = planning.resource_id
            left join public.tournament_match_events as event_link
              on event_link.match_id = match.id
            left join public.events as event
              on event.id = event_link.event_id
            where match.tournament_id = target_tournament.id
              and match.series_id = series.id
              and match.phase = 'finals'
          ), '[]'::jsonb),
          'pools', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', pool.id,
                'number', pool.display_order + 1,
                'matches', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', match.id,
                      'display_order', match.display_order,
                      'team_a_id', match.team_a_id,
                      'team_a_label', public.tournament_team_public_label(match.team_a_id),
                      'team_b_id', match.team_b_id,
                      'team_b_label', public.tournament_team_public_label(match.team_b_id),
                      'play_date', planning.play_date,
                      'starts_at', planning.starts_at,
                      'ends_at', planning.ends_at,
                      'scheduled_start_at', public.tournament_planning_starts_at(
                        planning.play_date,
                        planning.starts_at,
                        resource.timezone
                      ),
                      'scheduled_end_at', public.tournament_planning_starts_at(
                        planning.play_date,
                        planning.ends_at,
                        resource.timezone
                      ),
                      'resource_name', resource.name,
                      'result_status', result.status,
                      'score', case
                        when result.status = 'validated' then result.score
                        else null
                      end,
                      'team_a_sets', case
                        when result.status = 'validated' then result.team_a_sets
                        else null
                      end,
                      'team_b_sets', case
                        when result.status = 'validated' then result.team_b_sets
                        else null
                      end
                    )
                    order by planning.play_date, planning.starts_at, match.display_order
                  )
                  from public.tournament_matches as match
                  join public.tournament_match_planning as planning
                    on planning.match_id = match.id
                  join public.reservable_resources as resource
                    on resource.id = planning.resource_id
                  left join public.tournament_match_results as result
                    on result.match_id = match.id
                  where match.pool_id = pool.id
                    and match.phase = 'pools'
                ), '[]'::jsonb)
              )
              order by pool.display_order
            )
            from public.tournament_pools as pool
            where pool.tournament_id = target_tournament.id
              and pool.series_id = series.id
          ), '[]'::jsonb)
        )
        order by series.display_order, series.name
      )
      from public.tournament_series as series
      where series.tournament_id = target_tournament.id
        and series.enabled
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_tournament_results(uuid) from public;
grant execute on function public.get_public_tournament_results(uuid)
to anon, authenticated;

commit;
