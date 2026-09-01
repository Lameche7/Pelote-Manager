begin;

-- PR125 — un import Errebot prépare un tournoi avant son démarrage.
-- Les scores éventuellement présents dans le PDF source restent uniquement de
-- la provenance d'import : ils ne deviennent jamais des résultats sportifs
-- natifs sans saisie/validation explicite dans Pelote Manager.

-- Rattrape uniquement les résultats créés automatiquement par la migration
-- expérimentale précédente : ceux-ci n'ont ni auteur de saisie ni validateur et
-- leur score correspond exactement au score source Errebot conservé en privé.
delete from public.tournament_match_results as result
using public.tournament_import_fixture_refs as fixture,
      public.tournament_imports as import_row
where result.match_id = fixture.match_id
  and fixture.import_id = import_row.id
  and result.tournament_id = import_row.tournament_id
  and import_row.source = 'errebot'
  and import_row.status = 'imported'
  and result.status = 'validated'
  and result.submitted_by is null
  and result.validated_by is null
  and fixture.source_score_a is not null
  and fixture.source_score_b is not null
  and jsonb_typeof(coalesce(result.score->'sets', '[]'::jsonb)) = 'array'
  and jsonb_array_length(coalesce(result.score->'sets', '[]'::jsonb)) = 1
  and nullif(result.score->'sets'->0->>'team_a', '')::integer = fixture.source_score_a
  and nullif(result.score->'sets'->0->>'team_b', '')::integer = fixture.source_score_b;

-- Restaure le contrat d'import configuré : il peut dépublier temporairement un
-- tournoi Errebot existant pour corriger ses options, mais il ne touche jamais
-- aux résultats sportifs.
create or replace function public.admin_import_errebot_tournament_configured(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  input_file_hash text := lower(btrim(coalesce(payload->'file'->>'hash', '')));
  existing_tournament_id uuid;
  existing_tournament_status public.tournament_status;
  planning_was_unpublished boolean := false;
  import_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if input_file_hash ~ '^[0-9a-f]{64}$' then
    select
      import_row.tournament_id,
      tournament.status
    into
      existing_tournament_id,
      existing_tournament_status
    from public.tournament_imports as import_row
    join public.tournaments as tournament
      on tournament.id = import_row.tournament_id
     and tournament.club_id = target_club_id
    where import_row.club_id = target_club_id
      and import_row.source = 'errebot'
      and import_row.source_file_hash = input_file_hash
      and import_row.status = 'imported'
      and import_row.tournament_id is not null
    order by import_row.imported_at desc nulls last, import_row.created_at desc
    limit 1
    for update of import_row, tournament;
  end if;

  if existing_tournament_id is not null then
    if existing_tournament_status = 'planning_published' then
      perform public.admin_unpublish_tournament_planning(existing_tournament_id);
      planning_was_unpublished := true;
    elsif existing_tournament_status <> 'planning_generated' then
      raise exception 'Imported Errebot tournament options are locked after publication'
        using errcode = 'P0001';
    end if;
  end if;

  import_result := public.admin_import_errebot_tournament_configured_core(payload);

  return import_result || jsonb_build_object(
    'planningWasUnpublished', planning_was_unpublished
  );
end;
$$;

revoke all on function public.admin_import_errebot_tournament_configured(jsonb)
from public, anon, authenticated;
grant execute on function public.admin_import_errebot_tournament_configured(jsonb)
to authenticated;

drop function if exists public.sync_errebot_single_game_results(uuid);

comment on table public.tournament_import_fixture_refs is
  'Provenance privée des matchs importés. Les scores Errebot restent des données source et ne sont jamais transformés automatiquement en résultats natifs.';

commit;
