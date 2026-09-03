begin;

-- PR132 — consolide les droits joueur autour du compte Pelote Manager.
--
-- Une participation importée confirmée porte désormais un lien explicite vers
-- profiles.id. Ce lien devient la source de vérité pour les droits tournoi.
-- L'ancien rapprochement par email reste uniquement disponible pour les joueurs
-- natifs qui ne possèdent aucune identité externe, afin de ne pas casser les
-- inscriptions historiques de partenaires invités.

create or replace function public.tournament_profile_is_linked_to_team(
  target_team_id uuid,
  target_profile_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select profile.id, profile.member_id, profile.email
    from public.profiles as profile
    where profile.id = target_profile_id
  )
  select exists (
    select 1
    from public.tournament_teams as team
    cross join actor
    where team.id = target_team_id
      and team.status in ('pending', 'accepted')
      and (
        team.submitted_by = actor.id
        or exists (
          select 1
          from public.tournament_team_players as player
          left join public.tournament_external_player_identities as identity
            on identity.id = player.external_identity_id
          where player.team_id = team.id
            and (
              (
                actor.member_id is not null
                and player.member_id = actor.member_id
              )
              or (
                identity.status = 'verified'
                and identity.profile_id = actor.id
              )
              or (
                player.external_identity_id is null
                and nullif(btrim(actor.email), '') is not null
                and nullif(btrim(player.email), '') is not null
                and lower(btrim(player.email)) = lower(btrim(actor.email))
              )
            )
        )
      )
  );
$$;

revoke all on function public.tournament_profile_is_linked_to_team(uuid, uuid)
from public, anon, authenticated;

comment on function public.tournament_profile_is_linked_to_team(uuid, uuid) is
  'Détermine si un compte représente une équipe : déposant, licencié, identité externe vérifiée ; email uniquement pour un joueur natif sans identité externe.';

create or replace function public.tournament_profile_can_act_for_team(
  target_team_id uuid,
  target_profile_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tournament_teams as team
    where team.id = target_team_id
      and team.status = 'accepted'
  )
  and public.tournament_profile_is_linked_to_team(
    target_team_id,
    target_profile_id
  );
$$;

revoke all on function public.tournament_profile_can_act_for_team(uuid, uuid)
from public, anon, authenticated;

create or replace function public.tournament_profile_can_score_match(
  target_match_id uuid,
  target_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tournament_matches as match
    join public.tournament_teams as team
      on team.id in (match.team_a_id, match.team_b_id)
    where match.id = target_match_id
      and public.tournament_profile_can_act_for_team(
        team.id,
        target_profile_id
      )
  );
$$;

revoke all on function public.tournament_profile_can_score_match(uuid, uuid)
from public, anon, authenticated;

-- Mes tournois utilise le même lien d'identité que les commandes joueur.
create or replace function public.get_my_tournaments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  result jsonb;
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = current_profile_id
  ) then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  with my_teams as (
    select distinct on (team.tournament_id)
      team.id,
      team.tournament_id,
      team.series_id,
      team.status,
      team.submitted_by,
      team.registered_at
    from public.tournament_teams as team
    where team.status in ('pending', 'accepted')
      and public.tournament_profile_is_linked_to_team(
        team.id,
        current_profile_id
      )
    order by
      team.tournament_id,
      case when team.status = 'accepted' then 0 else 1 end,
      team.registered_at desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', tournament.id,
        'name', tournament.name,
        'status', tournament.status,
        'starts_on', tournament.starts_on,
        'ends_on', tournament.ends_on,
        'registration_closes_at', tournament.registration_closes_at,
        'sporting_rules', jsonb_build_object(
          'match_format', sporting_rules.match_format,
          'single_game_points', sporting_rules.single_game_points,
          'main_set_points', sporting_rules.main_set_points,
          'deciding_set_points', sporting_rules.deciding_set_points
        ),
        'team', jsonb_build_object(
          'id', team.id,
          'status', team.status,
          'series_id', series.id,
          'series_name', series.name,
          'series_color', series.color,
          'pool_number', pool_assignment.pool_number,
          'can_manage_registration',
            team.submitted_by = current_profile_id
            and tournament.status = 'registrations_open'
            and tournament.registration_closes_at > now(),
          'players', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'first_name', player.first_name,
                  'last_name', player.last_name,
                  'club_name', player.club_name,
                  'role', player.role
                )
                order by player.display_order
              ),
              '[]'::jsonb
            )
            from public.tournament_team_players as player
            where player.team_id = team.id
          )
        ),
        'planning_published', tournament.status in (
          'planning_published',
          'in_progress',
          'completed',
          'archived'
        ),
        'matches', case
          when tournament.status in (
            'planning_published',
            'in_progress',
            'completed',
            'archived'
          ) then (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', tournament_match.id,
                  'phase', tournament_match.phase,
                  'final_round', tournament_match.final_round,
                  'play_date', planning.play_date,
                  'starts_at', planning.starts_at,
                  'ends_at', planning.ends_at,
                  'resource_name', resource.name,
                  'pool_number', case
                    when tournament_match.phase = 'pools'
                      then match_pool.display_order + 1
                    else null
                  end,
                  'team_side', case
                    when tournament_match.team_a_id = team.id then 'a'
                    else 'b'
                  end,
                  'can_submit_result',
                    tournament.status in ('planning_published', 'in_progress')
                    and match_result.id is null
                    and public.tournament_planning_starts_at(
                      planning.play_date,
                      planning.ends_at,
                      resource.timezone
                    ) <= now(),
                  'result', case when match_result.id is null then null else jsonb_build_object(
                    'id', match_result.id,
                    'status', match_result.status,
                    'score', match_result.score,
                    'team_a_sets', match_result.team_a_sets,
                    'team_b_sets', match_result.team_b_sets,
                    'team_a_points', match_result.team_a_points,
                    'team_b_points', match_result.team_b_points,
                    'team_a_ranking_points', match_result.team_a_ranking_points,
                    'team_b_ranking_points', match_result.team_b_ranking_points,
                    'winner_team_id', match_result.winner_team_id
                  ) end,
                  'opponent_team_id', opponent.id,
                  'opponent_players', (
                    select coalesce(
                      jsonb_agg(
                        jsonb_build_object(
                          'first_name', opponent_player.first_name,
                          'last_name', opponent_player.last_name,
                          'club_name', opponent_player.club_name,
                          'role', opponent_player.role
                        )
                        order by opponent_player.display_order
                      ),
                      '[]'::jsonb
                    )
                    from public.tournament_team_players as opponent_player
                    where opponent_player.team_id = opponent.id
                  )
                )
                order by planning.play_date, planning.starts_at, resource.name
              ),
              '[]'::jsonb
            )
            from public.tournament_matches as tournament_match
            join public.tournament_match_planning as planning
              on planning.match_id = tournament_match.id
            join public.reservable_resources as resource
              on resource.id = planning.resource_id
            left join public.tournament_pools as match_pool
              on match_pool.id = tournament_match.pool_id
            join public.tournament_teams as opponent
              on opponent.id = case
                when tournament_match.team_a_id = team.id
                  then tournament_match.team_b_id
                else tournament_match.team_a_id
              end
            left join public.tournament_match_results as match_result
              on match_result.match_id = tournament_match.id
            where tournament_match.tournament_id = tournament.id
              and team.id in (
                tournament_match.team_a_id,
                tournament_match.team_b_id
              )
              and exists (
                select 1
                from public.tournament_match_events as event_link
                join public.events as event on event.id = event_link.event_id
                where event_link.match_id = tournament_match.id
                  and event.publication_status = 'published'
              )
          )
          else '[]'::jsonb
        end
      )
      order by
        case
          when tournament.status in ('completed', 'archived', 'cancelled') then 1
          else 0
        end,
        tournament.starts_on,
        tournament.name
    ),
    '[]'::jsonb
  )
  into result
  from my_teams as team
  join public.tournaments as tournament on tournament.id = team.tournament_id
  join public.tournament_series as series on series.id = team.series_id
  join public.tournament_sporting_rules as sporting_rules
    on sporting_rules.tournament_id = tournament.id
  left join lateral (
    select pool.display_order + 1 as pool_number
    from public.tournament_pool_teams as assignment
    join public.tournament_pools as pool on pool.id = assignment.pool_id
    where assignment.team_id = team.id
    limit 1
  ) as pool_assignment on true;

  return result;
end;
$$;

revoke all on function public.get_my_tournaments()
from public, anon, authenticated;
grant execute on function public.get_my_tournaments() to authenticated;

-- Les scénarios de qualification utilisent la même autorité d'identité.
create or replace function public.get_my_tournament_qualification_scenarios()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = current_profile_id
  ) then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      case
        when public.tournament_qualification_zone_message(
          coalesce((scenario->>'qualifier_count')::integer, 0),
          coalesce((scenario->>'current_position')::integer, 0)
        ) is null then scenario
        else jsonb_set(
          scenario,
          '{message}',
          to_jsonb(
            public.tournament_qualification_zone_message(
              coalesce((scenario->>'qualifier_count')::integer, 0),
              coalesce((scenario->>'current_position')::integer, 0)
            ) || ' ' || coalesce(scenario->>'message', '')
          )
        )
      end
      order by starts_on desc, team_id
    )
    from (
      select
        tournament.starts_on,
        team.id as team_id,
        public.tournament_team_qualification_scenario(
          team.tournament_id,
          team.series_id,
          team.id
        ) as scenario
      from public.tournament_teams as team
      join public.tournaments as tournament on tournament.id = team.tournament_id
      where team.status = 'accepted'
        and tournament.status in (
          'pools_validated',
          'planning_generated',
          'planning_published',
          'in_progress',
          'completed',
          'archived'
        )
        and public.tournament_profile_can_act_for_team(
          team.id,
          current_profile_id
        )
    ) as scenarios
    where scenario is not null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_my_tournament_qualification_scenarios()
from public, anon, authenticated;
grant execute on function public.get_my_tournament_qualification_scenarios()
to authenticated;

commit;
