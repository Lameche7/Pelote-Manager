begin;

-- PR129 — Le classeur réel Bizanos contient plus de 22 000 disponibilités.
-- L'ancien validateur construisait les JSON ligne par ligne et cherchait les
-- doublons dans des tableaux PL/pgSQL croissants. Le coût devenait quadratique.
-- Cette version normalise/contrôle le payload par ensembles SQL et l'import
-- applique également les disponibilités en masse.

create or replace function public.validate_errebot_availability_import_payload(
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
  target_tournament public.tournaments;
  target_import_id uuid;
  rows_payload jsonb := coalesce(payload->'rows', '[]'::jsonb);
  declarations_payload jsonb := coalesce(payload->'declarations', '[]'::jsonb);
  source_slots_payload jsonb := coalesce(payload->'source_slots', '[]'::jsonb);
  declarations_are_array boolean := jsonb_typeof(coalesce(payload->'declarations', '[]'::jsonb)) = 'array';
  rows_are_array boolean := jsonb_typeof(coalesce(payload->'rows', '[]'::jsonb)) = 'array';
  result jsonb;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

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

  if jsonb_typeof(source_slots_payload) <> 'array'
     or jsonb_array_length(source_slots_payload) = 0 then
    return jsonb_build_object(
      'valid', false,
      'row_count', 0,
      'source_slot_count', 0,
      'team_count', 0,
      'pool_team_count', 0,
      'finals_team_count', 0,
      'normalized_rows', '[]'::jsonb,
      'normalized_declarations', '[]'::jsonb,
      'normalized_source_slots', '[]'::jsonb,
      'errors', jsonb_build_array(
        jsonb_build_object(
          'row', 0,
          'code', 'missing_source_grid',
          'message', 'Aucune colonne de créneau Errebot n’a été reconnue.'
        )
      )
    );
  end if;

  if not declarations_are_array then
    declarations_payload := '[]'::jsonb;
  end if;
  if not rows_are_array then
    rows_payload := '[]'::jsonb;
  end if;

  with
  source_input as (
    select
      ordinality::integer as row_index,
      btrim(coalesce(value->>'phase', '')) as phase,
      btrim(coalesce(value->>'play_date', '')) as play_date,
      btrim(coalesce(value->>'starts_at', '')) as starts_at,
      btrim(coalesce(value->>'ends_at', '')) as ends_at,
      nullif(btrim(coalesce(value->>'source_slot_id', '')), '') as source_slot_id
    from jsonb_array_elements(source_slots_payload) with ordinality as source(value, ordinality)
  ),
  source_checked as (
    select
      source_input.*,
      (
        phase in ('pools', 'finals')
        and play_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        and starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        and ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      ) as shape_valid,
      case
        when starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        then split_part(starts_at, ':', 1)::integer * 60
           + split_part(starts_at, ':', 2)::integer
        else null
      end as start_minute,
      case
        when ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        then split_part(ends_at, ':', 1)::integer * 60
           + split_part(ends_at, ':', 2)::integer
        else null
      end as end_minute
    from source_input
  ),
  source_ranked as (
    select
      source_checked.*,
      row_number() over (
        partition by phase, play_date, left(starts_at, 5), left(ends_at, 5)
        order by row_index
      ) as duplicate_rank
    from source_checked
  ),
  normalized_source as (
    select
      phase,
      play_date,
      left(starts_at, 5) as starts_at,
      left(ends_at, 5) as ends_at,
      source_slot_id
    from source_ranked
    where shape_valid
      and end_minute > start_minute
      and duplicate_rank = 1
  ),
  source_errors as (
    select
      row_index as row,
      'invalid_source_slot'::text as code,
      'Colonne de créneau Errebot invalide.'::text as message
    from source_ranked
    where not shape_valid

    union all

    select
      row_index,
      'invalid_source_slot',
      'La fin du créneau Errebot doit être après son début.'
    from source_ranked
    where shape_valid
      and end_minute <= start_minute
  ),
  grid_errors as (
    select
      0::integer as row,
      'missing_pool_grid'::text as code,
      'Aucun créneau de poules Errebot n’a été reconnu.'::text as message
    where not exists (
      select 1 from normalized_source where phase = 'pools'
    )

    union all

    select
      0,
      'missing_finals_grid',
      'Aucun créneau de phases finales Errebot n’a été reconnu.'
    where not exists (
      select 1 from normalized_source where phase = 'finals'
    )

    union all

    select
      0,
      'invalid_finals_dates',
      'Les créneaux de phases finales doivent commencer après la fin des poules.'
    where exists (
      select 1 from normalized_source where phase = 'finals'
    )
      and (
        select min(play_date)
        from normalized_source
        where phase = 'finals'
      ) <= target_tournament.pool_ends_on::text
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
      btrim(coalesce(value->>'external_team_id', '')) as external_team_id,
      btrim(coalesce(value->>'phase', '')) as phase,
      case
        when coalesce(value->>'slot_count', '') ~ '^[0-9]+$'
        then (value->>'slot_count')::integer
        else 0
      end as slot_count
    from jsonb_array_elements(declarations_payload)
      with ordinality as declaration(value, ordinality)
  ),
  declaration_joined as (
    select
      declaration_input.*,
      team_refs.team_id,
      (
        external_team_id <> ''
        and phase in ('pools', 'finals')
      ) as shape_valid
    from declaration_input
    left join team_refs
      on team_refs.external_team_id = declaration_input.external_team_id
  ),
  declaration_ranked as (
    select
      declaration_joined.*,
      row_number() over (
        partition by external_team_id, phase
        order by row_index
      ) as duplicate_rank
    from declaration_joined
  ),
  normalized_declaration as (
    select
      external_team_id,
      team_id,
      phase,
      greatest(slot_count, 0) as slot_count
    from declaration_ranked
    where shape_valid
      and team_id is not null
      and duplicate_rank = 1
  ),
  declaration_errors as (
    select
      0::integer as row,
      'empty_workbook'::text as code,
      'Aucune équipe Errebot à importer.'::text as message
    where not declarations_are_array
       or jsonb_array_length(declarations_payload) = 0

    union all

    select
      row_index,
      'invalid_declaration',
      'Équipe ou phase Errebot invalide.'
    from declaration_ranked
    where not shape_valid

    union all

    select
      row_index,
      'unknown_team',
      concat('Équipe Errebot ', external_team_id, ' introuvable ou inactive.')
    from declaration_ranked
    where shape_valid
      and team_id is null

    union all

    select
      row_index,
      'duplicate_team_phase',
      concat('Équipe ', external_team_id, ' dupliquée pour la phase ', phase, '.')
    from declaration_ranked
    where shape_valid
      and team_id is not null
      and duplicate_rank > 1
  ),
  row_input as (
    select
      ordinality::integer as row_index,
      btrim(coalesce(value->>'external_team_id', '')) as external_team_id,
      btrim(coalesce(value->>'phase', '')) as phase,
      btrim(coalesce(value->>'play_date', '')) as play_date,
      btrim(coalesce(value->>'starts_at', '')) as starts_at,
      btrim(coalesce(value->>'ends_at', '')) as ends_at
    from jsonb_array_elements(rows_payload)
      with ordinality as availability(value, ordinality)
  ),
  row_checked as (
    select
      row_input.*,
      (
        external_team_id <> ''
        and phase in ('pools', 'finals')
        and play_date ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        and starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        and ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      ) as shape_valid
    from row_input
  ),
  row_joined as (
    select
      row_checked.*,
      declaration.team_id,
      source.phase as source_phase
    from row_checked
    left join normalized_declaration as declaration
      on declaration.external_team_id = row_checked.external_team_id
     and declaration.phase = row_checked.phase
    left join normalized_source as source
      on source.phase = row_checked.phase
     and source.play_date = row_checked.play_date
     and source.starts_at = left(row_checked.starts_at, 5)
     and source.ends_at = left(row_checked.ends_at, 5)
  ),
  row_ranked as (
    select
      row_joined.*,
      row_number() over (
        partition by team_id, phase, play_date, left(starts_at, 5), left(ends_at, 5)
        order by row_index
      ) as duplicate_rank
    from row_joined
  ),
  normalized_row as (
    select
      external_team_id,
      team_id,
      phase,
      play_date,
      left(starts_at, 5) as starts_at,
      left(ends_at, 5) as ends_at
    from row_ranked
    where shape_valid
      and team_id is not null
      and source_phase is not null
      and duplicate_rank = 1
  ),
  row_errors as (
    select
      row_index as row,
      'invalid_row'::text as code,
      'Disponibilité impossible à interpréter.'::text as message
    from row_ranked
    where not shape_valid

    union all

    select
      row_index,
      'missing_team_phase',
      'Cette disponibilité ne correspond à aucune équipe de la phase concernée.'
    from row_ranked
    where shape_valid
      and team_id is null

    union all

    select
      row_index,
      'unknown_slot',
      'Cette disponibilité ne correspond à aucun créneau Errebot de la phase concernée.'
    from row_ranked
    where shape_valid
      and team_id is not null
      and source_phase is null

    union all

    select
      row_index,
      'duplicate_slot',
      concat('Créneau en doublon pour l’équipe ', external_team_id, '.')
    from row_ranked
    where shape_valid
      and team_id is not null
      and source_phase is not null
      and duplicate_rank > 1
  ),
  row_counts as (
    select
      team_id,
      phase,
      count(*)::integer as slot_count
    from normalized_row
    group by team_id, phase
  ),
  mismatch_errors as (
    select
      0::integer as row,
      'slot_count_mismatch'::text as code,
      concat(
        'Le nombre de disponibilités de l’équipe ',
        declaration.external_team_id,
        ' est incohérent pour la phase ',
        declaration.phase,
        '.'
      )::text as message
    from normalized_declaration as declaration
    left join row_counts
      on row_counts.team_id = declaration.team_id
     and row_counts.phase = declaration.phase
    where declaration.slot_count <> coalesce(row_counts.slot_count, 0)
  ),
  all_errors as (
    select * from source_errors
    union all
    select * from grid_errors
    union all
    select * from declaration_errors
    union all
    select * from row_errors
    union all
    select * from mismatch_errors
  ),
  normalized_source_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'phase', phase,
          'play_date', play_date,
          'starts_at', starts_at,
          'ends_at', ends_at,
          'source_slot_id', source_slot_id
        )
        order by play_date, starts_at, phase
      ),
      '[]'::jsonb
    ) as value
    from normalized_source
  ),
  normalized_declaration_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'external_team_id', external_team_id,
          'team_id', team_id,
          'phase', phase,
          'slot_count', slot_count
        )
        order by external_team_id, phase
      ),
      '[]'::jsonb
    ) as value
    from normalized_declaration
  ),
  normalized_row_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'external_team_id', external_team_id,
          'team_id', team_id,
          'phase', phase,
          'play_date', play_date,
          'starts_at', starts_at,
          'ends_at', ends_at
        )
        order by external_team_id, phase, play_date, starts_at
      ),
      '[]'::jsonb
    ) as value
    from normalized_row
  ),
  errors_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'row', row,
          'code', code,
          'message', message
        )
        order by row, code, message
      ),
      '[]'::jsonb
    ) as value
    from all_errors
  ),
  summary as (
    select
      (select count(*)::integer from normalized_row) as row_count,
      (select count(*)::integer from normalized_source) as source_slot_count,
      (select count(distinct team_id)::integer from normalized_declaration) as team_count,
      (select count(*)::integer from normalized_declaration where phase = 'pools') as pool_team_count,
      (select count(*)::integer from normalized_declaration where phase = 'finals') as finals_team_count
  )
  select jsonb_build_object(
    'valid', jsonb_array_length(errors_json.value) = 0,
    'row_count', summary.row_count,
    'source_slot_count', summary.source_slot_count,
    'team_count', summary.team_count,
    'pool_team_count', summary.pool_team_count,
    'finals_team_count', summary.finals_team_count,
    'normalized_rows', normalized_row_json.value,
    'normalized_declarations', normalized_declaration_json.value,
    'normalized_source_slots', normalized_source_json.value,
    'errors', errors_json.value
  )
  into result
  from summary
  cross join normalized_source_json
  cross join normalized_declaration_json
  cross join normalized_row_json
  cross join errors_json;

  return result;
end;
$$;

create or replace function public.admin_preview_errebot_availability_import(
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
  validation jsonb;
  accepted_team_count integer := 0;
  pools_before integer := 0;
  finals_before integer := 0;
  pools_new integer := 0;
  finals_new integer := 0;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.tournaments as tournament
    where tournament.id = target_tournament_id
      and tournament.club_id = target_club_id
  ) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.tournament_imports as import_row
    where import_row.tournament_id = target_tournament_id
      and import_row.source = 'errebot'
  ) then
    raise exception 'Tournament is not an Errebot import' using errcode = 'P0001';
  end if;

  validation := public.validate_errebot_availability_import_payload(
    target_tournament_id,
    payload
  );

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

  select count(*)::integer
  into pools_new
  from jsonb_array_elements(
    coalesce(validation->'normalized_declarations', '[]'::jsonb)
  ) as declaration(value)
  left join public.tournament_import_team_availability_state as state
    on state.team_id = (declaration.value->>'team_id')::uuid
  where declaration.value->>'phase' = 'pools'
    and coalesce(state.pools_known, false) is false;

  select count(*)::integer
  into finals_new
  from jsonb_array_elements(
    coalesce(validation->'normalized_declarations', '[]'::jsonb)
  ) as declaration(value)
  left join public.tournament_import_team_availability_state as state
    on state.team_id = (declaration.value->>'team_id')::uuid
  where declaration.value->>'phase' = 'finals'
    and coalesce(state.finals_known, false) is false;

  -- Ne jamais renvoyer les ~23 000 lignes normalisées au navigateur pendant
  -- la prévisualisation : le client n'utilise que les compteurs et les erreurs.
  return jsonb_build_object(
    'valid', coalesce((validation->>'valid')::boolean, false),
    'row_count', coalesce((validation->>'row_count')::integer, 0),
    'source_slot_count', coalesce((validation->>'source_slot_count')::integer, 0),
    'team_count', coalesce((validation->>'team_count')::integer, 0),
    'pool_team_count', coalesce((validation->>'pool_team_count')::integer, 0),
    'finals_team_count', coalesce((validation->>'finals_team_count')::integer, 0),
    'errors', coalesce(validation->'errors', '[]'::jsonb),
    'accepted_team_count', accepted_team_count,
    'pools_known_team_count_before', pools_before,
    'pools_known_team_count_after', least(pools_before + pools_new, accepted_team_count),
    'finals_known_team_count_before', finals_before,
    'finals_known_team_count_after', least(finals_before + finals_new, accepted_team_count),
    'pools_coverage_complete_after',
      accepted_team_count > 0
      and least(pools_before + pools_new, accepted_team_count) = accepted_team_count,
    'finals_coverage_complete_after',
      accepted_team_count > 0
      and least(finals_before + finals_new, accepted_team_count) = accepted_team_count,
    'coverage_complete_after',
      accepted_team_count > 0
      and least(pools_before + pools_new, accepted_team_count) = accepted_team_count
      and least(finals_before + finals_new, accepted_team_count) = accepted_team_count
  );
end;
$$;

create or replace function public.admin_import_errebot_availability(
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
  validation jsonb;
  normalized_rows jsonb;
  normalized_declarations jsonb;
  normalized_source_slots jsonb;
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

  validation := public.validate_errebot_availability_import_payload(
    target_tournament.id,
    payload
  );
  if coalesce((validation->>'valid')::boolean, false) is not true then
    raise exception 'Errebot availability import is invalid' using errcode = '22023';
  end if;

  normalized_rows := coalesce(validation->'normalized_rows', '[]'::jsonb);
  normalized_declarations := coalesce(
    validation->'normalized_declarations',
    '[]'::jsonb
  );
  normalized_source_slots := coalesce(
    validation->'normalized_source_slots',
    '[]'::jsonb
  );

  -- Supprime en une fois les anciennes disponibilités appartenant à une grille
  -- Errebot remplacée (ancienne ou nouvelle grille de la phase importée).
  with
  declarations as (
    select
      (value->>'team_id')::uuid as team_id,
      value->>'phase' as phase
    from jsonb_array_elements(normalized_declarations) as declaration(value)
  ),
  source_grid as (
    select
      source.phase,
      source.play_date,
      source.starts_at,
      source.ends_at
    from public.tournament_import_availability_slots as source
    where source.tournament_id = target_tournament.id

    union

    select
      value->>'phase',
      (value->>'play_date')::date,
      (value->>'starts_at')::time,
      (value->>'ends_at')::time
    from jsonb_array_elements(normalized_source_slots) as source(value)
  )
  delete from public.tournament_team_availability_slots as availability
  using declarations
  where availability.tournament_id = target_tournament.id
    and availability.team_id = declarations.team_id
    and exists (
      select 1
      from source_grid
      where source_grid.phase = declarations.phase
        and source_grid.play_date = availability.play_date
        and source_grid.starts_at = availability.starts_at
        and source_grid.ends_at = availability.ends_at
    );

  insert into public.tournament_team_availability_slots (
    team_id,
    tournament_id,
    play_date,
    starts_at,
    ends_at
  )
  select
    (value->>'team_id')::uuid,
    target_tournament.id,
    (value->>'play_date')::date,
    (value->>'starts_at')::time,
    (value->>'ends_at')::time
  from jsonb_array_elements(normalized_rows) as availability(value);

  -- Initialise toutes les équipes importées en une seule requête.
  insert into public.tournament_import_team_availability_state (
    team_id,
    tournament_id,
    import_id,
    slot_count,
    imported_by,
    imported_at
  )
  select distinct
    (value->>'team_id')::uuid,
    target_tournament.id,
    target_import_id,
    0,
    auth.uid(),
    now()
  from jsonb_array_elements(normalized_declarations) as declaration(value)
  on conflict (team_id) do update set
    tournament_id = excluded.tournament_id,
    import_id = excluded.import_id,
    imported_by = excluded.imported_by,
    imported_at = excluded.imported_at;

  -- Puis renseigne les deux phases sans rescanner 23 000 lignes pour chaque équipe.
  with phase_state as (
    select
      (value->>'team_id')::uuid as team_id,
      bool_or(value->>'phase' = 'pools') as pools_imported,
      bool_or(value->>'phase' = 'finals') as finals_imported,
      max((value->>'slot_count')::integer)
        filter (where value->>'phase' = 'pools') as pools_slot_count,
      max((value->>'slot_count')::integer)
        filter (where value->>'phase' = 'finals') as finals_slot_count
    from jsonb_array_elements(normalized_declarations) as declaration(value)
    group by (value->>'team_id')::uuid
  )
  update public.tournament_import_team_availability_state as state
  set
    pools_known = case
      when phase_state.pools_imported then true
      else state.pools_known
    end,
    pools_slot_count = case
      when phase_state.pools_imported then coalesce(phase_state.pools_slot_count, 0)
      else state.pools_slot_count
    end,
    finals_known = case
      when phase_state.finals_imported then true
      else state.finals_known
    end,
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
  where tournament_id = target_tournament.id;

  delete from public.tournament_import_availability_slots
  where tournament_id = target_tournament.id;

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
    target_tournament.id,
    target_import_id,
    value->>'phase',
    (value->>'play_date')::date,
    (value->>'starts_at')::time,
    (value->>'ends_at')::time,
    nullif(value->>'source_slot_id', '')
  from jsonb_array_elements(normalized_source_slots) as source(value);

  select
    min((value->>'play_date')::date),
    max((value->>'play_date')::date)
  into finals_start, finals_end
  from jsonb_array_elements(normalized_source_slots) as source(value)
  where value->>'phase' = 'finals';

  update public.tournaments
  set
    finals_starts_on = finals_start,
    finals_ends_on = finals_end,
    ends_on = greatest(ends_on, finals_end),
    updated_at = now()
  where id = target_tournament.id;

  select count(distinct (value->>'team_id')::uuid)::integer
  into imported_team_count
  from jsonb_array_elements(normalized_declarations) as declaration(value);

  imported_slot_count := jsonb_array_length(normalized_rows);
  source_slot_count := jsonb_array_length(normalized_source_slots);

  select count(*)::integer
  into accepted_team_count
  from public.tournament_teams as team
  where team.tournament_id = target_tournament.id
    and team.status = 'accepted';

  select
    count(*) filter (where state.pools_known)::integer,
    count(*) filter (where state.finals_known)::integer
  into pools_known_team_count, finals_known_team_count
  from public.tournament_import_team_availability_state as state
  join public.tournament_teams as team
    on team.id = state.team_id
  where state.tournament_id = target_tournament.id
    and team.status = 'accepted';

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  ) values (
    target_tournament.id,
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
      'finals_ends_on', finals_end
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
    'pools_coverage_complete',
      accepted_team_count > 0
      and pools_known_team_count = accepted_team_count,
    'finals_coverage_complete',
      accepted_team_count > 0
      and finals_known_team_count = accepted_team_count,
    'coverage_complete',
      accepted_team_count > 0
      and pools_known_team_count = accepted_team_count
      and finals_known_team_count = accepted_team_count
  );
end;
$$;

revoke all on function public.validate_errebot_availability_import_payload(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_preview_errebot_availability_import(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_import_errebot_availability(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.admin_preview_errebot_availability_import(uuid, jsonb)
to authenticated;
grant execute on function public.admin_import_errebot_availability(uuid, jsonb)
to authenticated;

commit;
