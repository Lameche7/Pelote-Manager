begin;

-- PR129 — Deuxième optimisation du fichier réel Bizanos.
-- La première version compacte réduisait fortement le transport HTTP mais
-- reconstruisait encore ~23 000 objets JSON avant la validation. Cette version
-- traite directement les identifiants de créneaux groupés : aucune grosse
-- reconstruction JSON n'est nécessaire pour la preview ni pour l'import.

create or replace function public.admin_preview_errebot_availability_import_compact(
  target_tournament_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  target_import_id uuid;
  accepted_team_count integer := 0;
  pools_before integer := 0;
  finals_before integer := 0;
  result jsonb;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  select import_row.id
  into target_import_id
  from public.tournament_imports as import_row
  where import_row.tournament_id = target_tournament_id
    and import_row.source = 'errebot'
  order by import_row.imported_at desc nulls last, import_row.created_at desc
  limit 1;

  if target_import_id is null then
    raise exception 'Tournament is not an Errebot import' using errcode = 'P0001';
  end if;

  select count(*)::integer
  into accepted_team_count
  from public.tournament_teams as team
  where team.tournament_id = target_tournament_id
    and team.status = 'accepted';

  select
    count(*) filter (where state.pools_known)::integer,
    count(*) filter (where state.finals_known)::integer
  into pools_before, finals_before
  from public.tournament_import_team_availability_state as state
  join public.tournament_teams as team
    on team.id = state.team_id
  where state.tournament_id = target_tournament_id
    and team.status = 'accepted';

  with
  source_input as (
    select
      ordinality::integer as row_index,
      btrim(coalesce(source.value->>'phase', '')) as phase,
      btrim(coalesce(source.value->>'play_date', '')) as play_date,
      btrim(coalesce(source.value->>'starts_at', '')) as starts_at,
      btrim(coalesce(source.value->>'ends_at', '')) as ends_at,
      nullif(btrim(coalesce(source.value->>'source_slot_id', '')), '') as source_slot_id
    from jsonb_array_elements(
      case
        when jsonb_typeof(payload->'source_slots') = 'array'
          then payload->'source_slots'
        else '[]'::jsonb
      end
    ) with ordinality as source(value, ordinality)
  ),
  source_ranked as (
    select
      source_input.*,
      (
        phase in ('pools', 'finals')
        and source_slot_id is not null
        and play_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        and starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      ) as shape_valid,
      row_number() over (
        partition by source_slot_id
        order by row_index
      ) as id_rank
    from source_input
  ),
  source_valid as (
    select phase, play_date, starts_at, ends_at, source_slot_id
    from source_ranked
    where shape_valid
      and id_rank = 1
      and ends_at > starts_at
  ),
  team_refs as (
    select distinct on (ref.external_team_id)
      ref.external_team_id,
      ref.team_id
    from public.tournament_import_team_refs as ref
    join public.tournament_teams as team
      on team.id = ref.team_id
    where ref.import_id = target_import_id
      and team.tournament_id = target_tournament_id
      and team.status = 'accepted'
    order by ref.external_team_id, ref.team_id
  ),
  declaration_input as (
    select
      ordinality::integer as row_index,
      btrim(coalesce(declaration.value->>'external_team_id', '')) as external_team_id,
      btrim(coalesce(declaration.value->>'phase', '')) as phase,
      case
        when coalesce(declaration.value->>'slot_count', '') ~ '^[0-9]+$'
          then (declaration.value->>'slot_count')::integer
        else -1
      end as slot_count
    from jsonb_array_elements(
      case
        when jsonb_typeof(payload->'declarations') = 'array'
          then payload->'declarations'
        else '[]'::jsonb
      end
    ) with ordinality as declaration(value, ordinality)
  ),
  declaration_ranked as (
    select
      declaration_input.*,
      team_refs.team_id,
      row_number() over (
        partition by declaration_input.external_team_id, declaration_input.phase
        order by declaration_input.row_index
      ) as declaration_rank
    from declaration_input
    left join team_refs
      on team_refs.external_team_id = declaration_input.external_team_id
  ),
  declaration_valid as (
    select external_team_id, team_id, phase, slot_count
    from declaration_ranked
    where external_team_id <> ''
      and phase in ('pools', 'finals')
      and slot_count >= 0
      and team_id is not null
      and declaration_rank = 1
  ),
  group_input as (
    select
      ordinality::integer as row_index,
      btrim(coalesce(group_row.value->>'external_team_id', '')) as external_team_id,
      btrim(coalesce(group_row.value->>'phase', '')) as phase,
      case
        when jsonb_typeof(group_row.value->'source_slot_ids') = 'array'
          then group_row.value->'source_slot_ids'
        else '[]'::jsonb
      end as source_slot_ids
    from jsonb_array_elements(
      case
        when jsonb_typeof(payload->'availability_by_team') = 'array'
          then payload->'availability_by_team'
        else '[]'::jsonb
      end
    ) with ordinality as group_row(value, ordinality)
  ),
  selected_input as (
    select
      group_input.row_index,
      group_input.external_team_id,
      group_input.phase,
      slot.ordinality::integer as slot_index,
      slot.value as source_slot_id
    from group_input
    cross join lateral jsonb_array_elements_text(group_input.source_slot_ids)
      with ordinality as slot(value, ordinality)
  ),
  selected_ranked as (
    select
      selected_input.*,
      declaration_valid.team_id,
      source_valid.play_date,
      source_valid.starts_at,
      source_valid.ends_at,
      row_number() over (
        partition by selected_input.external_team_id, selected_input.phase, selected_input.source_slot_id
        order by selected_input.row_index, selected_input.slot_index
      ) as selected_rank
    from selected_input
    left join declaration_valid
      on declaration_valid.external_team_id = selected_input.external_team_id
     and declaration_valid.phase = selected_input.phase
    left join source_valid
      on source_valid.phase = selected_input.phase
     and source_valid.source_slot_id = selected_input.source_slot_id
  ),
  selected_counts as (
    select
      external_team_id,
      phase,
      count(*)::integer as slot_count
    from selected_ranked
    where team_id is not null
      and play_date is not null
      and selected_rank = 1
    group by external_team_id, phase
  ),
  raw_errors as (
    select
      row_index as row,
      'invalid_source_slot'::text as code,
      'Créneau source Errebot invalide.'::text as message
    from source_ranked
    where not shape_valid
       or ends_at <= starts_at

    union all

    select
      row_index,
      'duplicate_source_slot_id',
      concat('Identifiant de créneau Errebot dupliqué : ', source_slot_id, '.')
    from source_ranked
    where shape_valid
      and id_rank > 1

    union all

    select
      0,
      'missing_pool_grid',
      'Aucun créneau de poules Errebot n’a été reconnu.'
    where not exists (select 1 from source_valid where phase = 'pools')

    union all

    select
      0,
      'missing_finals_grid',
      'Aucun créneau de phases finales Errebot n’a été reconnu.'
    where not exists (select 1 from source_valid where phase = 'finals')

    union all

    select
      0,
      'invalid_finals_dates',
      'Les créneaux de phases finales doivent commencer après la fin des poules.'
    where exists (select 1 from source_valid where phase = 'finals')
      and (
        select min(play_date)::date
        from source_valid
        where phase = 'finals'
      ) <= target_tournament.pool_ends_on

    union all

    select
      row_index,
      'invalid_declaration',
      'Équipe ou phase Errebot invalide.'
    from declaration_ranked
    where external_team_id = ''
       or phase not in ('pools', 'finals')
       or slot_count < 0

    union all

    select
      row_index,
      'unknown_team',
      concat('Équipe Errebot ', external_team_id, ' introuvable ou inactive.')
    from declaration_ranked
    where external_team_id <> ''
      and phase in ('pools', 'finals')
      and slot_count >= 0
      and team_id is null

    union all

    select
      row_index,
      'duplicate_team_phase',
      concat('Équipe ', external_team_id, ' dupliquée pour la phase ', phase, '.')
    from declaration_ranked
    where declaration_rank > 1

    union all

    select
      row_index,
      'unknown_team_phase',
      'Un groupe de disponibilités ne correspond à aucune équipe de la phase concernée.'
    from selected_ranked
    where team_id is null

    union all

    select
      row_index,
      'unknown_source_slot',
      concat('Créneau Errebot ', source_slot_id, ' introuvable pour cette phase.')
    from selected_ranked
    where team_id is not null
      and play_date is null

    union all

    select
      row_index,
      'duplicate_slot',
      concat('Créneau en doublon pour l’équipe ', external_team_id, '.')
    from selected_ranked
    where team_id is not null
      and play_date is not null
      and selected_rank > 1

    union all

    select
      0,
      'slot_count_mismatch',
      concat(
        'Le nombre de disponibilités de l’équipe ',
        declaration_valid.external_team_id,
        ' est incohérent pour la phase ',
        declaration_valid.phase,
        '.'
      )
    from declaration_valid
    left join selected_counts
      on selected_counts.external_team_id = declaration_valid.external_team_id
     and selected_counts.phase = declaration_valid.phase
    where declaration_valid.slot_count <> coalesce(selected_counts.slot_count, 0)
  ),
  error_summary as (
    select count(*)::integer as error_count
    from raw_errors
  ),
  errors_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('row', row, 'code', code, 'message', message)
        order by row, code, message
      ),
      '[]'::jsonb
    ) as errors
    from (
      select *
      from raw_errors
      order by row, code, message
      limit 20
    ) as limited_errors
  ),
  summary as (
    select
      coalesce((select sum(slot_count)::integer from selected_counts), 0) as row_count,
      (select count(*)::integer from source_valid) as source_slot_count,
      (select count(distinct team_id)::integer from declaration_valid) as team_count,
      (select count(*)::integer from declaration_valid where phase = 'pools') as pool_team_count,
      (select count(*)::integer from declaration_valid where phase = 'finals') as finals_team_count,
      (select count(*)::integer from declaration_valid d
        left join public.tournament_import_team_availability_state s on s.team_id = d.team_id
        where d.phase = 'pools' and coalesce(s.pools_known, false) is false) as pools_new,
      (select count(*)::integer from declaration_valid d
        left join public.tournament_import_team_availability_state s on s.team_id = d.team_id
        where d.phase = 'finals' and coalesce(s.finals_known, false) is false) as finals_new
  )
  select jsonb_build_object(
    'valid', error_summary.error_count = 0,
    'row_count', summary.row_count,
    'source_slot_count', summary.source_slot_count,
    'team_count', summary.team_count,
    'pool_team_count', summary.pool_team_count,
    'finals_team_count', summary.finals_team_count,
    'errors', errors_json.errors,
    'accepted_team_count', accepted_team_count,
    'pools_known_team_count_before', pools_before,
    'pools_known_team_count_after', least(pools_before + summary.pools_new, accepted_team_count),
    'finals_known_team_count_before', finals_before,
    'finals_known_team_count_after', least(finals_before + summary.finals_new, accepted_team_count),
    'pools_coverage_complete_after', accepted_team_count > 0
      and least(pools_before + summary.pools_new, accepted_team_count) = accepted_team_count,
    'finals_coverage_complete_after', accepted_team_count > 0
      and least(finals_before + summary.finals_new, accepted_team_count) = accepted_team_count,
    'coverage_complete_after', accepted_team_count > 0
      and least(pools_before + summary.pools_new, accepted_team_count) = accepted_team_count
      and least(finals_before + summary.finals_new, accepted_team_count) = accepted_team_count
  )
  into result
  from summary
  cross join error_summary
  cross join errors_json;

  return result;
end;
$$;

create or replace function public.admin_import_errebot_availability_compact(
  target_tournament_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  target_import_id uuid;
  preview jsonb;
  imported_team_count integer := 0;
  imported_slot_count integer := 0;
  source_slot_count integer := 0;
  accepted_team_count integer := 0;
  pools_known_team_count integer := 0;
  finals_known_team_count integer := 0;
  finals_start date;
  finals_end date;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status in ('completed', 'archived', 'cancelled') then
    raise exception 'Tournament availability cannot be imported at this stage'
      using errcode = 'P0001';
  end if;

  select import_row.id
  into target_import_id
  from public.tournament_imports as import_row
  where import_row.tournament_id = target_tournament.id
    and import_row.source = 'errebot'
  order by import_row.imported_at desc nulls last, import_row.created_at desc
  limit 1;

  if target_import_id is null then
    raise exception 'Tournament is not an Errebot import' using errcode = 'P0001';
  end if;

  preview := public.admin_preview_errebot_availability_import_compact(
    target_tournament_id,
    payload
  );
  if coalesce((preview->>'valid')::boolean, false) is not true then
    raise exception 'Errebot availability import is invalid' using errcode = '22023';
  end if;

  -- Les CTE suivants restent relationnels : les ~23 000 choix sont développés
  -- comme lignes SQL uniquement au moment de l'insertion, jamais en gros JSON.
  with
  source_input as (
    select
      btrim(source.value->>'phase') as phase,
      (source.value->>'play_date')::date as play_date,
      (source.value->>'starts_at')::time as starts_at,
      (source.value->>'ends_at')::time as ends_at,
      btrim(source.value->>'source_slot_id') as source_slot_id
    from jsonb_array_elements(payload->'source_slots') as source(value)
  ),
  team_refs as (
    select distinct on (ref.external_team_id)
      ref.external_team_id,
      ref.team_id
    from public.tournament_import_team_refs as ref
    join public.tournament_teams as team on team.id = ref.team_id
    where ref.import_id = target_import_id
      and team.tournament_id = target_tournament_id
      and team.status = 'accepted'
    order by ref.external_team_id, ref.team_id
  ),
  declaration_input as (
    select
      btrim(declaration.value->>'external_team_id') as external_team_id,
      btrim(declaration.value->>'phase') as phase,
      (declaration.value->>'slot_count')::integer as slot_count
    from jsonb_array_elements(payload->'declarations') as declaration(value)
  ),
  declarations as (
    select
      declaration_input.external_team_id,
      team_refs.team_id,
      declaration_input.phase,
      declaration_input.slot_count
    from declaration_input
    join team_refs
      on team_refs.external_team_id = declaration_input.external_team_id
  ),
  new_source_grid as (
    select distinct phase, play_date, starts_at, ends_at
    from source_input
  ),
  old_and_new_grid as (
    select phase, play_date, starts_at, ends_at
    from public.tournament_import_availability_slots
    where tournament_id = target_tournament_id

    union

    select phase, play_date, starts_at, ends_at
    from new_source_grid
  )
  delete from public.tournament_team_availability_slots as availability
  using declarations
  where availability.tournament_id = target_tournament_id
    and availability.team_id = declarations.team_id
    and exists (
      select 1
      from old_and_new_grid as grid
      where grid.phase = declarations.phase
        and grid.play_date = availability.play_date
        and grid.starts_at = availability.starts_at
        and grid.ends_at = availability.ends_at
    );

  with
  source_input as (
    select
      btrim(source.value->>'phase') as phase,
      (source.value->>'play_date')::date as play_date,
      (source.value->>'starts_at')::time as starts_at,
      (source.value->>'ends_at')::time as ends_at,
      btrim(source.value->>'source_slot_id') as source_slot_id
    from jsonb_array_elements(payload->'source_slots') as source(value)
  ),
  team_refs as (
    select distinct on (ref.external_team_id)
      ref.external_team_id,
      ref.team_id
    from public.tournament_import_team_refs as ref
    join public.tournament_teams as team on team.id = ref.team_id
    where ref.import_id = target_import_id
      and team.tournament_id = target_tournament_id
      and team.status = 'accepted'
    order by ref.external_team_id, ref.team_id
  ),
  selected as (
    select
      team_refs.team_id,
      btrim(group_row.value->>'phase') as phase,
      slot.value as source_slot_id
    from jsonb_array_elements(payload->'availability_by_team') as group_row(value)
    join team_refs
      on team_refs.external_team_id = btrim(group_row.value->>'external_team_id')
    cross join lateral jsonb_array_elements_text(group_row.value->'source_slot_ids') as slot(value)
  )
  insert into public.tournament_team_availability_slots (
    team_id,
    tournament_id,
    play_date,
    starts_at,
    ends_at
  )
  select
    selected.team_id,
    target_tournament_id,
    source_input.play_date,
    source_input.starts_at,
    source_input.ends_at
  from selected
  join source_input
    on source_input.phase = selected.phase
   and source_input.source_slot_id = selected.source_slot_id;

  with
  team_refs as (
    select distinct on (ref.external_team_id)
      ref.external_team_id,
      ref.team_id
    from public.tournament_import_team_refs as ref
    join public.tournament_teams as team on team.id = ref.team_id
    where ref.import_id = target_import_id
      and team.tournament_id = target_tournament_id
      and team.status = 'accepted'
    order by ref.external_team_id, ref.team_id
  ),
  declarations as (
    select
      team_refs.team_id,
      btrim(declaration.value->>'phase') as phase,
      (declaration.value->>'slot_count')::integer as slot_count
    from jsonb_array_elements(payload->'declarations') as declaration(value)
    join team_refs
      on team_refs.external_team_id = btrim(declaration.value->>'external_team_id')
  )
  insert into public.tournament_import_team_availability_state (
    team_id,
    tournament_id,
    import_id,
    slot_count,
    imported_by,
    imported_at
  )
  select distinct
    declarations.team_id,
    target_tournament_id,
    target_import_id,
    0,
    auth.uid(),
    now()
  from declarations
  on conflict (team_id) do update set
    tournament_id = excluded.tournament_id,
    import_id = excluded.import_id,
    imported_by = excluded.imported_by,
    imported_at = excluded.imported_at;

  with
  team_refs as (
    select distinct on (ref.external_team_id)
      ref.external_team_id,
      ref.team_id
    from public.tournament_import_team_refs as ref
    join public.tournament_teams as team on team.id = ref.team_id
    where ref.import_id = target_import_id
      and team.tournament_id = target_tournament_id
      and team.status = 'accepted'
    order by ref.external_team_id, ref.team_id
  ),
  declarations as (
    select
      team_refs.team_id,
      btrim(declaration.value->>'phase') as phase,
      (declaration.value->>'slot_count')::integer as slot_count
    from jsonb_array_elements(payload->'declarations') as declaration(value)
    join team_refs
      on team_refs.external_team_id = btrim(declaration.value->>'external_team_id')
  ),
  phase_state as (
    select
      team_id,
      bool_or(phase = 'pools') as pools_imported,
      bool_or(phase = 'finals') as finals_imported,
      max(slot_count) filter (where phase = 'pools') as pools_slot_count,
      max(slot_count) filter (where phase = 'finals') as finals_slot_count
    from declarations
    group by team_id
  )
  update public.tournament_import_team_availability_state as state
  set
    pools_known = case when phase_state.pools_imported then true else state.pools_known end,
    pools_slot_count = case
      when phase_state.pools_imported then coalesce(phase_state.pools_slot_count, 0)
      else state.pools_slot_count
    end,
    finals_known = case when phase_state.finals_imported then true else state.finals_known end,
    finals_slot_count = case
      when phase_state.finals_imported then coalesce(phase_state.finals_slot_count, 0)
      else state.finals_slot_count
    end,
    imported_by = auth.uid(),
    imported_at = now()
  from phase_state
  where state.team_id = phase_state.team_id;

  update public.tournament_import_team_availability_state
  set slot_count = pools_slot_count + finals_slot_count
  where tournament_id = target_tournament_id;

  delete from public.tournament_import_availability_slots
  where tournament_id = target_tournament_id;

  insert into public.tournament_import_availability_slots (
    tournament_id,
    import_id,
    phase,
    play_date,
    starts_at,
    ends_at,
    source_slot_id
  )
  select
    target_tournament_id,
    target_import_id,
    btrim(source.value->>'phase'),
    (source.value->>'play_date')::date,
    (source.value->>'starts_at')::time,
    (source.value->>'ends_at')::time,
    nullif(btrim(source.value->>'source_slot_id'), '')
  from jsonb_array_elements(payload->'source_slots') as source(value);

  select
    min((source.value->>'play_date')::date),
    max((source.value->>'play_date')::date)
  into finals_start, finals_end
  from jsonb_array_elements(payload->'source_slots') as source(value)
  where source.value->>'phase' = 'finals';

  update public.tournaments
  set
    finals_starts_on = finals_start,
    finals_ends_on = finals_end,
    ends_on = greatest(ends_on, finals_end),
    updated_at = now()
  where id = target_tournament_id;

  imported_team_count := coalesce((preview->>'team_count')::integer, 0);
  imported_slot_count := coalesce((preview->>'row_count')::integer, 0);
  source_slot_count := coalesce((preview->>'source_slot_count')::integer, 0);

  select count(*)::integer
  into accepted_team_count
  from public.tournament_teams as team
  where team.tournament_id = target_tournament_id
    and team.status = 'accepted';

  select
    count(*) filter (where state.pools_known)::integer,
    count(*) filter (where state.finals_known)::integer
  into pools_known_team_count, finals_known_team_count
  from public.tournament_import_team_availability_state as state
  join public.tournament_teams as team on team.id = state.team_id
  where state.tournament_id = target_tournament_id
    and team.status = 'accepted';

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  ) values (
    target_tournament_id,
    'errebot_availability_imported',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'team_count', imported_team_count,
      'availability_count', imported_slot_count,
      'source_slot_count', source_slot_count,
      'pools_known_team_count', pools_known_team_count,
      'finals_known_team_count', finals_known_team_count,
      'accepted_team_count', accepted_team_count,
      'finals_structure_imported', false,
      'finals_starts_on', finals_start,
      'finals_ends_on', finals_end,
      'payload_mode', 'compact_direct'
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'imported_team_count', imported_team_count,
    'imported_slot_count', imported_slot_count,
    'source_slot_count', source_slot_count,
    'accepted_team_count', accepted_team_count,
    'pools_known_team_count', pools_known_team_count,
    'finals_known_team_count', finals_known_team_count,
    'pools_coverage_complete', accepted_team_count > 0
      and pools_known_team_count = accepted_team_count,
    'finals_coverage_complete', accepted_team_count > 0
      and finals_known_team_count = accepted_team_count,
    'coverage_complete', accepted_team_count > 0
      and pools_known_team_count = accepted_team_count
      and finals_known_team_count = accepted_team_count
  );
end;
$$;

revoke all on function public.admin_preview_errebot_availability_import_compact(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_import_errebot_availability_compact(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.admin_preview_errebot_availability_import_compact(uuid, jsonb)
to authenticated;
grant execute on function public.admin_import_errebot_availability_compact(uuid, jsonb)
to authenticated;

commit;
