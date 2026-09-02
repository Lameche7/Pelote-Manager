begin;

-- PR127 — Errebot n'importe aucune structure de phase finale.
-- En revanche, le classeur de disponibilités contient deux matrices utiles :
-- poules et phases finales. Les disponibilités finales sont conservées comme
-- contraintes de planification afin que Pelote Manager puisse générer ensuite
-- son propre tableau final avec ses propres seeds, matchs et règles.

alter table public.tournament_import_team_availability_state
add column if not exists pools_known boolean not null default false;

alter table public.tournament_import_team_availability_state
add column if not exists finals_known boolean not null default false;

alter table public.tournament_import_team_availability_state
add column if not exists pools_slot_count integer not null default 0
check (pools_slot_count >= 0);

alter table public.tournament_import_team_availability_state
add column if not exists finals_slot_count integer not null default 0
check (finals_slot_count >= 0);

create table if not exists public.tournament_import_availability_slots (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  import_id uuid not null references public.tournament_imports (id) on delete cascade,
  phase text not null check (phase in ('pools', 'finals')),
  play_date date not null,
  starts_at time not null,
  ends_at time not null,
  source_slot_id text,
  created_at timestamptz not null default now(),
  primary key (tournament_id, phase, play_date, starts_at, ends_at),
  check (ends_at > starts_at)
);

create index if not exists tournament_import_availability_slots_import_idx
on public.tournament_import_availability_slots (import_id, phase, play_date, starts_at);

alter table public.tournament_import_availability_slots enable row level security;
revoke all on table public.tournament_import_availability_slots
from public, anon, authenticated;

-- Une base ayant déjà reçu la variante « poules uniquement » possède des lignes
-- d'état valides pour les poules. On les convertit explicitement.
update public.tournament_import_team_availability_state
set
  pools_known = true,
  pools_slot_count = slot_count
where slot_count >= 0
  and not pools_known
  and not finals_known;

-- La grille exacte Errebot remplace la génération hebdomadaire pour la phase
-- correspondante. Cela permet notamment d'exposer les créneaux finals même si
-- aucun match final n'existe encore. Les matchs restent créés exclusivement par
-- le moteur final natif de Pelote Manager.
create or replace function public.tournament_generated_slots(
  target_tournament_id uuid
)
returns table (
  play_date date,
  starts_at time,
  ends_at time,
  phase text
)
language sql
stable
security definer
set search_path = ''
as $$
  with source_slots as (
    select source.play_date, source.starts_at, source.ends_at, source.phase
    from public.tournament_import_availability_slots as source
    where source.tournament_id = target_tournament_id
  ),
  source_phases as (
    select distinct source.phase
    from source_slots as source
  ),
  target as (
    select
      tournament.id,
      tournament.pool_starts_on,
      tournament.pool_ends_on,
      tournament.finals_starts_on,
      tournament.finals_ends_on,
      make_interval(mins => tournament.slot_duration_minutes) as slot_interval
    from public.tournaments as tournament
    where tournament.id = target_tournament_id
  ),
  native_phases as (
    select
      target.id as tournament_id,
      target.pool_starts_on as starts_on,
      target.pool_ends_on as ends_on,
      target.slot_interval,
      'pools'::text as phase
    from target
    where not exists (
      select 1 from source_phases where source_phases.phase = 'pools'
    )

    union all

    select
      target.id,
      target.finals_starts_on,
      target.finals_ends_on,
      target.slot_interval,
      'finals'::text
    from target
    where target.finals_starts_on is not null
      and target.finals_ends_on is not null
      and not exists (
        select 1 from source_phases where source_phases.phase = 'finals'
      )
  ),
  native_slots as (
    select distinct
      date_series.play_timestamp::date as play_date,
      slot_series.starts_at::time as starts_at,
      (slot_series.starts_at + native_phases.slot_interval)::time as ends_at,
      native_phases.phase
    from native_phases
    cross join lateral generate_series(
      native_phases.starts_on::timestamp,
      native_phases.ends_on::timestamp,
      interval '1 day'
    ) as date_series(play_timestamp)
    join public.tournament_play_windows as play_window
      on play_window.tournament_id = native_phases.tournament_id
     and play_window.weekday = extract(dow from date_series.play_timestamp)::integer
    cross join lateral generate_series(
      date_series.play_timestamp::date + play_window.opens_at,
      date_series.play_timestamp::date + play_window.closes_at - native_phases.slot_interval,
      native_phases.slot_interval
    ) as slot_series(starts_at)
  ),
  planned_slots as (
    select distinct
      planning.play_date,
      planning.starts_at,
      planning.ends_at,
      match.phase
    from public.tournament_matches as match
    join public.tournament_match_planning as planning on planning.match_id = match.id
    where match.tournament_id = target_tournament_id
      and match.phase in ('pools', 'finals')
  )
  select source.play_date, source.starts_at, source.ends_at, source.phase
  from source_slots as source

  union

  select planned.play_date, planned.starts_at, planned.ends_at, planned.phase
  from planned_slots as planned

  union

  select native.play_date, native.starts_at, native.ends_at, native.phase
  from native_slots as native

  order by play_date, starts_at, ends_at, phase;
$$;

revoke all on function public.tournament_generated_slots(uuid)
from public, anon, authenticated;

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
  rows_payload jsonb := coalesce(payload->'rows', '[]'::jsonb);
  declarations_payload jsonb := coalesce(payload->'declarations', '[]'::jsonb);
  source_slots_payload jsonb := coalesce(payload->'source_slots', '[]'::jsonb);
  item jsonb;
  normalized_rows jsonb := '[]'::jsonb;
  normalized_declarations jsonb := '[]'::jsonb;
  normalized_source_slots jsonb := '[]'::jsonb;
  errors jsonb := '[]'::jsonb;
  row_index integer := 0;
  external_team_id text;
  target_phase text;
  play_date_text text;
  starts_at_text text;
  ends_at_text text;
  source_slot_id text;
  availability_date date;
  availability_starts_at time;
  availability_ends_at time;
  mapped_team_id uuid;
  item_key text;
  seen_keys text[] := '{}'::text[];
  row_count integer := 0;
  source_slot_count integer := 0;
  team_count integer := 0;
  pool_team_count integer := 0;
  finals_team_count integer := 0;
  declared_slot_count integer := 0;
  actual_slot_count integer := 0;
  final_min_date date;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

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

  for item in select value from jsonb_array_elements(source_slots_payload)
  loop
    row_index := row_index + 1;
    target_phase := btrim(coalesce(item->>'phase', ''));
    play_date_text := btrim(coalesce(item->>'play_date', ''));
    starts_at_text := btrim(coalesce(item->>'starts_at', ''));
    ends_at_text := btrim(coalesce(item->>'ends_at', ''));
    source_slot_id := nullif(btrim(coalesce(item->>'source_slot_id', '')), '');

    if target_phase not in ('pools', 'finals')
      or play_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or starts_at_text !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
      or ends_at_text !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then
      errors := errors || jsonb_build_array(
        jsonb_build_object(
          'row', row_index,
          'code', 'invalid_source_slot',
          'message', 'Colonne de créneau Errebot invalide.'
        )
      );
      continue;
    end if;

    begin
      availability_date := play_date_text::date;
      availability_starts_at := starts_at_text::time;
      availability_ends_at := ends_at_text::time;
    exception when others then
      errors := errors || jsonb_build_array(
        jsonb_build_object(
          'row', row_index,
          'code', 'invalid_source_slot',
          'message', 'Créneau Errebot impossible à interpréter.'
        )
      );
      continue;
    end;

    if availability_ends_at <= availability_starts_at then
      errors := errors || jsonb_build_array(
        jsonb_build_object(
          'row', row_index,
          'code', 'invalid_source_slot',
          'message', 'La fin du créneau Errebot doit être après son début.'
        )
      );
      continue;
    end if;

    item_key := concat(target_phase, '|', availability_date, '|', availability_starts_at, '|', availability_ends_at);
    if item_key = any(seen_keys) then
      continue;
    end if;

    seen_keys := array_append(seen_keys, item_key);
    normalized_source_slots := normalized_source_slots || jsonb_build_array(
      jsonb_build_object(
        'phase', target_phase,
        'play_date', availability_date,
        'starts_at', availability_starts_at,
        'ends_at', availability_ends_at,
        'source_slot_id', source_slot_id
      )
    );
  end loop;

  if not exists (
    select 1 from jsonb_array_elements(normalized_source_slots) as source(value)
    where source.value->>'phase' = 'pools'
  ) then
    errors := errors || jsonb_build_array(
      jsonb_build_object('row', 0, 'code', 'missing_pool_grid', 'message', 'Aucun créneau de poules Errebot n’a été reconnu.')
    );
  end if;

  if not exists (
    select 1 from jsonb_array_elements(normalized_source_slots) as source(value)
    where source.value->>'phase' = 'finals'
  ) then
    errors := errors || jsonb_build_array(
      jsonb_build_object('row', 0, 'code', 'missing_finals_grid', 'message', 'Aucun créneau de phases finales Errebot n’a été reconnu.')
    );
  else
    select min((source.value->>'play_date')::date)
    into final_min_date
    from jsonb_array_elements(normalized_source_slots) as source(value)
    where source.value->>'phase' = 'finals';

    if final_min_date <= target_tournament.pool_ends_on then
      errors := errors || jsonb_build_array(
        jsonb_build_object('row', 0, 'code', 'invalid_finals_dates', 'message', 'Les créneaux de phases finales doivent commencer après la fin des poules.')
      );
    end if;
  end if;

  if jsonb_typeof(declarations_payload) <> 'array'
     or jsonb_array_length(declarations_payload) = 0 then
    errors := errors || jsonb_build_array(
      jsonb_build_object('row', 0, 'code', 'empty_workbook', 'message', 'Aucune équipe Errebot à importer.')
    );
  else
    seen_keys := '{}'::text[];
    row_index := 0;
    for item in select value from jsonb_array_elements(declarations_payload)
    loop
      row_index := row_index + 1;
      external_team_id := btrim(coalesce(item->>'external_team_id', ''));
      target_phase := btrim(coalesce(item->>'phase', ''));
      mapped_team_id := null;

      if external_team_id = '' or target_phase not in ('pools', 'finals') then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'invalid_declaration', 'message', 'Équipe ou phase Errebot invalide.')
        );
        continue;
      end if;

      select ref.team_id
      into mapped_team_id
      from public.tournament_import_team_refs as ref
      join public.tournament_imports as import_row on import_row.id = ref.import_id
      join public.tournament_teams as team on team.id = ref.team_id
      where import_row.tournament_id = target_tournament_id
        and import_row.source = 'errebot'
        and ref.external_team_id = external_team_id
        and team.tournament_id = target_tournament_id
        and team.status = 'accepted'
      limit 1;

      if mapped_team_id is null then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'unknown_team', 'message', concat('Équipe Errebot ', external_team_id, ' introuvable ou inactive.'))
        );
        continue;
      end if;

      item_key := concat(mapped_team_id, '|', target_phase);
      if item_key = any(seen_keys) then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'duplicate_team_phase', 'message', concat('Équipe ', external_team_id, ' dupliquée pour la phase ', target_phase, '.'))
        );
        continue;
      end if;

      seen_keys := array_append(seen_keys, item_key);
      normalized_declarations := normalized_declarations || jsonb_build_array(
        jsonb_build_object(
          'external_team_id', external_team_id,
          'team_id', mapped_team_id,
          'phase', target_phase,
          'slot_count', greatest(coalesce((item->>'slot_count')::integer, 0), 0)
        )
      );
    end loop;
  end if;

  seen_keys := '{}'::text[];
  row_index := 0;
  if jsonb_typeof(rows_payload) = 'array' then
    for item in select value from jsonb_array_elements(rows_payload)
    loop
      row_index := row_index + 1;
      external_team_id := btrim(coalesce(item->>'external_team_id', ''));
      target_phase := btrim(coalesce(item->>'phase', ''));
      play_date_text := btrim(coalesce(item->>'play_date', ''));
      starts_at_text := btrim(coalesce(item->>'starts_at', ''));
      ends_at_text := btrim(coalesce(item->>'ends_at', ''));
      mapped_team_id := null;

      begin
        availability_date := play_date_text::date;
        availability_starts_at := starts_at_text::time;
        availability_ends_at := ends_at_text::time;
      exception when others then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'invalid_row', 'message', 'Disponibilité impossible à interpréter.')
        );
        continue;
      end;

      select (declaration.value->>'team_id')::uuid
      into mapped_team_id
      from jsonb_array_elements(normalized_declarations) as declaration(value)
      where declaration.value->>'external_team_id' = external_team_id
        and declaration.value->>'phase' = target_phase
      limit 1;

      if mapped_team_id is null then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'missing_team_phase', 'message', 'Cette disponibilité ne correspond à aucune équipe de la phase concernée.')
        );
        continue;
      end if;

      if not exists (
        select 1
        from jsonb_array_elements(normalized_source_slots) as source(value)
        where source.value->>'phase' = target_phase
          and (source.value->>'play_date')::date = availability_date
          and (source.value->>'starts_at')::time = availability_starts_at
          and (source.value->>'ends_at')::time = availability_ends_at
      ) then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'unknown_slot', 'message', 'Cette disponibilité ne correspond à aucun créneau Errebot de la phase concernée.')
        );
        continue;
      end if;

      item_key := concat(mapped_team_id, '|', target_phase, '|', availability_date, '|', availability_starts_at, '|', availability_ends_at);
      if item_key = any(seen_keys) then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'duplicate_slot', 'message', concat('Créneau en doublon pour l’équipe ', external_team_id, '.'))
        );
        continue;
      end if;

      seen_keys := array_append(seen_keys, item_key);
      normalized_rows := normalized_rows || jsonb_build_array(
        jsonb_build_object(
          'external_team_id', external_team_id,
          'team_id', mapped_team_id,
          'phase', target_phase,
          'play_date', availability_date,
          'starts_at', availability_starts_at,
          'ends_at', availability_ends_at
        )
      );
    end loop;
  end if;

  for item in select value from jsonb_array_elements(normalized_declarations)
  loop
    declared_slot_count := coalesce((item->>'slot_count')::integer, 0);
    select count(*)::integer
    into actual_slot_count
    from jsonb_array_elements(normalized_rows) as row(value)
    where (row.value->>'team_id')::uuid = (item->>'team_id')::uuid
      and row.value->>'phase' = item->>'phase';

    if declared_slot_count <> actual_slot_count then
      errors := errors || jsonb_build_array(
        jsonb_build_object('row', 0, 'code', 'slot_count_mismatch', 'message', concat('Le nombre de disponibilités de l’équipe ', item->>'external_team_id', ' est incohérent pour la phase ', item->>'phase', '.'))
      );
    end if;
  end loop;

  select count(*)::integer into row_count
  from jsonb_array_elements(normalized_rows);

  select count(*)::integer into source_slot_count
  from jsonb_array_elements(normalized_source_slots);

  select count(distinct value->>'team_id')::integer into team_count
  from jsonb_array_elements(normalized_declarations);

  select count(*)::integer into pool_team_count
  from jsonb_array_elements(normalized_declarations)
  where value->>'phase' = 'pools';

  select count(*)::integer into finals_team_count
  from jsonb_array_elements(normalized_declarations)
  where value->>'phase' = 'finals';

  return jsonb_build_object(
    'valid', jsonb_array_length(errors) = 0,
    'row_count', row_count,
    'source_slot_count', source_slot_count,
    'team_count', team_count,
    'pool_team_count', pool_team_count,
    'finals_team_count', finals_team_count,
    'normalized_rows', normalized_rows,
    'normalized_declarations', normalized_declarations,
    'normalized_source_slots', normalized_source_slots,
    'errors', errors
  );
end;
$$;

revoke all on function public.validate_errebot_availability_import_payload(uuid, jsonb)
from public, anon, authenticated;

create or replace function public.admin_get_errebot_availability_import_context(
  target_tournament_id uuid
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
  pools_known_team_count integer := 0;
  finals_known_team_count integer := 0;
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
  where import_row.tournament_id = target_tournament.id
    and import_row.source = 'errebot'
  order by import_row.imported_at desc nulls last, import_row.created_at desc
  limit 1;

  if target_import_id is null then
    return jsonb_build_object('enabled', false);
  end if;

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
  join public.tournament_teams as team on team.id = state.team_id
  where state.tournament_id = target_tournament.id
    and team.status = 'accepted';

  return jsonb_build_object(
    'enabled', true,
    'tournament_id', target_tournament.id,
    'tournament_name', target_tournament.name,
    'tournament_status', target_tournament.status,
    'slot_duration_minutes', target_tournament.slot_duration_minutes,
    'accepted_team_count', accepted_team_count,
    'finals_required', true,
    'pools_known_team_count', pools_known_team_count,
    'finals_known_team_count', finals_known_team_count,
    'pools_coverage_complete', accepted_team_count > 0 and pools_known_team_count = accepted_team_count,
    'finals_coverage_complete', accepted_team_count > 0 and finals_known_team_count = accepted_team_count,
    'coverage_complete', accepted_team_count > 0
      and pools_known_team_count = accepted_team_count
      and finals_known_team_count = accepted_team_count,
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'external_team_id', ref.external_team_id,
            'team_id', team.id,
            'label', public.tournament_team_public_label(team.id),
            'pools_known', coalesce(state.pools_known, false),
            'pools_slot_count', coalesce(state.pools_slot_count, 0),
            'finals_known', coalesce(state.finals_known, false),
            'finals_slot_count', coalesce(state.finals_slot_count, 0)
          )
          order by ref.external_team_id
        ),
        '[]'::jsonb
      )
      from public.tournament_import_team_refs as ref
      join public.tournament_teams as team on team.id = ref.team_id
      left join public.tournament_import_team_availability_state as state on state.team_id = team.id
      where ref.import_id = target_import_id
        and team.status = 'accepted'
    )
  );
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
    where tournament.id = target_tournament_id and tournament.club_id = target_club_id
  ) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.tournament_imports as import_row
    where import_row.tournament_id = target_tournament_id and import_row.source = 'errebot'
  ) then
    raise exception 'Tournament is not an Errebot import' using errcode = 'P0001';
  end if;

  validation := public.validate_errebot_availability_import_payload(target_tournament_id, payload);

  select count(*)::integer into accepted_team_count
  from public.tournament_teams as team
  where team.tournament_id = target_tournament_id and team.status = 'accepted';

  select
    count(*) filter (where state.pools_known)::integer,
    count(*) filter (where state.finals_known)::integer
  into pools_before, finals_before
  from public.tournament_import_team_availability_state as state
  join public.tournament_teams as team on team.id = state.team_id
  where state.tournament_id = target_tournament_id and team.status = 'accepted';

  select count(*)::integer into pools_new
  from jsonb_array_elements(coalesce(validation->'normalized_declarations', '[]'::jsonb)) as declaration(value)
  left join public.tournament_import_team_availability_state as state
    on state.team_id = (declaration.value->>'team_id')::uuid
  where declaration.value->>'phase' = 'pools'
    and coalesce(state.pools_known, false) is false;

  select count(*)::integer into finals_new
  from jsonb_array_elements(coalesce(validation->'normalized_declarations', '[]'::jsonb)) as declaration(value)
  left join public.tournament_import_team_availability_state as state
    on state.team_id = (declaration.value->>'team_id')::uuid
  where declaration.value->>'phase' = 'finals'
    and coalesce(state.finals_known, false) is false;

  return validation || jsonb_build_object(
    'accepted_team_count', accepted_team_count,
    'pools_known_team_count_before', pools_before,
    'pools_known_team_count_after', least(pools_before + pools_new, accepted_team_count),
    'finals_known_team_count_before', finals_before,
    'finals_known_team_count_after', least(finals_before + finals_new, accepted_team_count),
    'pools_coverage_complete_after', accepted_team_count > 0 and least(pools_before + pools_new, accepted_team_count) = accepted_team_count,
    'finals_coverage_complete_after', accepted_team_count > 0 and least(finals_before + finals_new, accepted_team_count) = accepted_team_count,
    'coverage_complete_after', accepted_team_count > 0
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
  declaration jsonb;
  target_team_id uuid;
  target_phase text;
  phase_slot_count integer;
  imported_team_ids uuid[] := '{}'::uuid[];
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

  select tournament.* into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id and tournament.club_id = target_club_id
  for update;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.status in ('completed', 'archived', 'cancelled') then
    raise exception 'Tournament availability cannot be imported at this stage' using errcode = 'P0001';
  end if;

  select import_row.id into target_import_id
  from public.tournament_imports as import_row
  where import_row.tournament_id = target_tournament.id and import_row.source = 'errebot'
  order by import_row.imported_at desc nulls last, import_row.created_at desc
  limit 1;

  if target_import_id is null then
    raise exception 'Tournament is not an Errebot import' using errcode = 'P0001';
  end if;

  validation := public.validate_errebot_availability_import_payload(target_tournament.id, payload);
  if coalesce((validation->>'valid')::boolean, false) is not true then
    raise exception 'Errebot availability import is invalid' using errcode = '22023';
  end if;

  normalized_rows := coalesce(validation->'normalized_rows', '[]'::jsonb);
  normalized_declarations := coalesce(validation->'normalized_declarations', '[]'::jsonb);
  normalized_source_slots := coalesce(validation->'normalized_source_slots', '[]'::jsonb);

  for declaration in select value from jsonb_array_elements(normalized_declarations)
  loop
    target_team_id := (declaration->>'team_id')::uuid;
    target_phase := declaration->>'phase';

    delete from public.tournament_team_availability_slots as availability
    where availability.tournament_id = target_tournament.id
      and availability.team_id = target_team_id
      and (
        exists (
          select 1 from public.tournament_import_availability_slots as source
          where source.tournament_id = target_tournament.id
            and source.phase = target_phase
            and source.play_date = availability.play_date
            and source.starts_at = availability.starts_at
            and source.ends_at = availability.ends_at
        )
        or exists (
          select 1 from jsonb_array_elements(normalized_source_slots) as source(value)
          where source.value->>'phase' = target_phase
            and (source.value->>'play_date')::date = availability.play_date
            and (source.value->>'starts_at')::time = availability.starts_at
            and (source.value->>'ends_at')::time = availability.ends_at
        )
      );

    insert into public.tournament_team_availability_slots (
      team_id, tournament_id, play_date, starts_at, ends_at
    )
    select
      target_team_id,
      target_tournament.id,
      (row.value->>'play_date')::date,
      (row.value->>'starts_at')::time,
      (row.value->>'ends_at')::time
    from jsonb_array_elements(normalized_rows) as row(value)
    where (row.value->>'team_id')::uuid = target_team_id
      and row.value->>'phase' = target_phase;

    select count(*)::integer into phase_slot_count
    from jsonb_array_elements(normalized_rows) as row(value)
    where (row.value->>'team_id')::uuid = target_team_id
      and row.value->>'phase' = target_phase;

    insert into public.tournament_import_team_availability_state (
      team_id, tournament_id, import_id, slot_count, imported_by, imported_at
    ) values (
      target_team_id, target_tournament.id, target_import_id, 0, auth.uid(), now()
    )
    on conflict (team_id) do update set
      tournament_id = excluded.tournament_id,
      import_id = excluded.import_id,
      imported_by = excluded.imported_by,
      imported_at = excluded.imported_at;

    update public.tournament_import_team_availability_state as state
    set
      pools_known = case when target_phase = 'pools' then true else state.pools_known end,
      pools_slot_count = case when target_phase = 'pools' then phase_slot_count else state.pools_slot_count end,
      finals_known = case when target_phase = 'finals' then true else state.finals_known end,
      finals_slot_count = case when target_phase = 'finals' then phase_slot_count else state.finals_slot_count end,
      imported_by = auth.uid(),
      imported_at = now()
    where state.team_id = target_team_id;

    if not (target_team_id = any(imported_team_ids)) then
      imported_team_ids := array_append(imported_team_ids, target_team_id);
    end if;
  end loop;

  update public.tournament_import_team_availability_state
  set slot_count = pools_slot_count + finals_slot_count
  where tournament_id = target_tournament.id;

  delete from public.tournament_import_availability_slots
  where tournament_id = target_tournament.id;

  insert into public.tournament_import_availability_slots (
    tournament_id, import_id, phase, play_date, starts_at, ends_at, source_slot_id
  )
  select
    target_tournament.id,
    target_import_id,
    source.value->>'phase',
    (source.value->>'play_date')::date,
    (source.value->>'starts_at')::time,
    (source.value->>'ends_at')::time,
    nullif(source.value->>'source_slot_id', '')
  from jsonb_array_elements(normalized_source_slots) as source(value);

  select min((source.value->>'play_date')::date), max((source.value->>'play_date')::date)
  into finals_start, finals_end
  from jsonb_array_elements(normalized_source_slots) as source(value)
  where source.value->>'phase' = 'finals';

  -- On importe seulement la fenêtre et les disponibilités nécessaires au futur
  -- planning final. Aucun seed, aucun match et aucun tableau final n'est créé ici.
  update public.tournaments
  set
    finals_starts_on = finals_start,
    finals_ends_on = finals_end,
    ends_on = greatest(ends_on, finals_end),
    updated_at = now()
  where id = target_tournament.id;

  imported_team_count := coalesce(array_length(imported_team_ids, 1), 0);
  imported_slot_count := jsonb_array_length(normalized_rows);
  source_slot_count := jsonb_array_length(normalized_source_slots);

  select count(*)::integer into accepted_team_count
  from public.tournament_teams as team
  where team.tournament_id = target_tournament.id and team.status = 'accepted';

  select
    count(*) filter (where state.pools_known)::integer,
    count(*) filter (where state.finals_known)::integer
  into pools_known_team_count, finals_known_team_count
  from public.tournament_import_team_availability_state as state
  join public.tournament_teams as team on team.id = state.team_id
  where state.tournament_id = target_tournament.id and team.status = 'accepted';

  insert into public.tournament_audit_log (
    tournament_id, action, before_status, after_status, payload, created_by
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
    'pools_coverage_complete', accepted_team_count > 0 and pools_known_team_count = accepted_team_count,
    'finals_coverage_complete', accepted_team_count > 0 and finals_known_team_count = accepted_team_count,
    'coverage_complete', accepted_team_count > 0
      and pools_known_team_count = accepted_team_count
      and finals_known_team_count = accepted_team_count
  );
end;
$$;

revoke all on function public.admin_get_errebot_availability_import_context(uuid)
from public, anon, authenticated;
revoke all on function public.admin_preview_errebot_availability_import(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_import_errebot_availability(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.admin_get_errebot_availability_import_context(uuid)
to authenticated;
grant execute on function public.admin_preview_errebot_availability_import(uuid, jsonb)
to authenticated;
grant execute on function public.admin_import_errebot_availability(uuid, jsonb)
to authenticated;

-- Pour les reports, la couverture est vérifiée selon la phase du match.
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
  target_phase text;
  is_errebot_import boolean := false;
  accepted_team_count integer := 0;
  known_team_count integer := 0;
  coverage_complete boolean := false;
  restrict_swaps boolean := false;
begin
  result := public.get_my_tournament_reschedule_options_engine(target_match_id, requester_team_id);

  select match.tournament_id, match.phase
  into target_tournament_id, target_phase
  from public.tournament_matches as match
  where match.id = target_match_id;

  select exists (
    select 1 from public.tournament_imports as import_row
    where import_row.tournament_id = target_tournament_id and import_row.source = 'errebot'
  ) into is_errebot_import;

  if is_errebot_import and target_phase in ('pools', 'finals') then
    select count(*)::integer into accepted_team_count
    from public.tournament_teams as team
    where team.tournament_id = target_tournament_id and team.status = 'accepted';

    select count(*)::integer into known_team_count
    from public.tournament_import_team_availability_state as state
    join public.tournament_teams as team on team.id = state.team_id
    where state.tournament_id = target_tournament_id
      and team.status = 'accepted'
      and case
        when target_phase = 'finals' then state.finals_known
        else state.pools_known
      end;

    coverage_complete := accepted_team_count > 0 and known_team_count = accepted_team_count;
    restrict_swaps := not coverage_complete;
  end if;

  result := jsonb_set(
    result,
    '{policy}',
    coalesce(result->'policy', '{}'::jsonb) || jsonb_build_object(
      'swaps_enabled', not restrict_swaps,
      'availability_source', case
        when is_errebot_import and coverage_complete then 'errebot_imported'
        when is_errebot_import and known_team_count > 0 then 'partial_from_errebot'
        when is_errebot_import then 'unknown_from_errebot'
        else 'not_required'
      end,
      'availability_known_team_count', known_team_count,
      'availability_team_count', accepted_team_count,
      'availability_coverage_complete', coverage_complete,
      'swap_restriction_reason', case
        when restrict_swaps then 'errebot_availability_incomplete'
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