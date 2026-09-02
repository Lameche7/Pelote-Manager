begin;

-- Un import Errebot peut fournir le planning sans les créneaux choisis par les
-- équipes lors de l'inscription. Dans ce cas, l'absence de disponibilités dans
-- Pelote Manager signifie « inconnues », jamais « toutes disponibles ».
--
-- Le moteur de calcul existant reste inchangé pour les tournois natifs. On le
-- place derrière un wrapper qui neutralise les échanges pour un tournoi Errebot
-- tant qu'aucune disponibilité d'équipe n'a été importée. Les créneaux réellement
-- libres restent proposés : ils devront ensuite être acceptés par les deux équipes.

do $$
begin
  if to_regprocedure(
    'public.get_my_tournament_reschedule_options_engine(uuid,uuid)'
  ) is null then
    alter function public.get_my_tournament_reschedule_options(uuid, uuid)
      rename to get_my_tournament_reschedule_options_engine;
  end if;
end
$$;

revoke all on function public.get_my_tournament_reschedule_options_engine(uuid, uuid)
from public, anon, authenticated;

create or replace function public.get_my_tournament_reschedule_options(
  target_match_id uuid,
  requester_team_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  target_tournament_id uuid;
  is_errebot_import boolean := false;
  has_imported_availability boolean := false;
  restrict_swaps boolean := false;
begin
  -- Le moteur interne conserve tous ses contrôles d'autorisation, de publication,
  -- de résultat, d'occupation et de charge journalière.
  result := public.get_my_tournament_reschedule_options_engine(
    target_match_id,
    requester_team_id
  );

  select match.tournament_id
  into target_tournament_id
  from public.tournament_matches as match
  where match.id = target_match_id;

  select exists (
    select 1
    from public.tournament_imports as import_row
    where import_row.tournament_id = target_tournament_id
      and import_row.source = 'errebot'
  )
  into is_errebot_import;

  select exists (
    select 1
    from public.tournament_team_availability_slots as availability
    join public.tournament_teams as team on team.id = availability.team_id
    where team.tournament_id = target_tournament_id
  )
  into has_imported_availability;

  restrict_swaps := is_errebot_import and not has_imported_availability;

  result := jsonb_set(
    result,
    '{policy}',
    coalesce(result->'policy', '{}'::jsonb) || jsonb_build_object(
      'swaps_enabled', not restrict_swaps,
      'availability_source', case
        when restrict_swaps then 'unknown_from_errebot'
        when has_imported_availability then 'declared'
        else 'not_required'
      end,
      'swap_restriction_reason', case
        when restrict_swaps then 'errebot_availability_not_imported'
        else null
      end
    ),
    true
  );

  if restrict_swaps then
    result := jsonb_set(result, '{swaps}', '[]'::jsonb, true);
  end if;

  return result;
end;
$$;

revoke all on function public.get_my_tournament_reschedule_options(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.get_my_tournament_reschedule_options(uuid, uuid)
to authenticated;

commit;
