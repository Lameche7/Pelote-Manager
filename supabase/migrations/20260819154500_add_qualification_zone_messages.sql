begin;

-- Décrit la zone sportive correspondant au classement général actuel.
-- Pour un nombre de qualifiés non puissance de deux, les mieux classés sont
-- directement placés dans le tableau principal et les suivants disputent le
-- tour préliminaire (barrage).
create or replace function public.tournament_qualification_zone_message(
  qualifier_count integer,
  current_position integer
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  bracket_size integer;
  direct_qualifier_count integer;
begin
  if qualifier_count < 2 or current_position < 1 then
    return null;
  end if;

  bracket_size := public.tournament_main_bracket_size(qualifier_count);
  direct_qualifier_count := case
    when qualifier_count = bracket_size then qualifier_count
    else 2 * bracket_size - qualifier_count
  end;

  if current_position <= direct_qualifier_count then
    return format(
      'À ce classement, vous êtes dans la zone de qualification directe (places 1 à %s).',
      direct_qualifier_count
    );
  end if;

  if current_position <= qualifier_count then
    return format(
      'À ce classement, vous êtes dans la zone des barragistes (places %s à %s).',
      direct_qualifier_count + 1,
      qualifier_count
    );
  end if;

  return format(
    'À ce classement, vous êtes hors de la zone qualificative (top %s).',
    qualifier_count
  );
end;
$$;

revoke all on function public.tournament_qualification_zone_message(integer, integer)
from public, anon, authenticated;

-- Conserve le moteur de scénarios existant comme source de vérité et enrichit
-- seulement son message avec la zone actuelle. Cette couche reste donc valable
-- pour les scénarios exacts de dernière journée comme pour les situations qui
-- dépendent encore d'autres résultats.
create or replace function public.get_my_tournament_qualification_scenarios()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = auth.uid();

  if current_profile.id is null then
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
        and (
          team.submitted_by = current_profile.id
          or exists (
            select 1
            from public.tournament_team_players as player
            where player.team_id = team.id
              and (
                (
                  current_profile.member_id is not null
                  and player.member_id = current_profile.member_id
                )
                or (
                  nullif(btrim(current_profile.email), '') is not null
                  and nullif(btrim(player.email), '') is not null
                  and lower(btrim(player.email)) = lower(btrim(current_profile.email))
                )
              )
          )
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
