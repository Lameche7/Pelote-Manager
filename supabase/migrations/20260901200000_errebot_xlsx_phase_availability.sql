begin;

-- Le vrai export Errebot contient deux matrices de disponibilités (poules et
-- phases finales) et la grille exacte des créneaux dans les en-têtes Excel.
-- Cette migration conserve cette grille comme provenance et la projette dans le
-- modèle natif sans modifier le planning des matchs déjà importés.

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

with phase_counts as (
  select
    state.team_id,
    count(*) filter (where generated.phase = 'pools')::integer as pools_slot_count,
    count(*) filter (where generated.phase = 'finals')::integer as finals_slot_count
  from public.tournament_import_team_availability_state as state
  left join public.tournament_team_availability_slots as availability
    on availability.tournament_id = state.tournament_id
   and availability.team_id = state.team_id
  left join lateral public.tournament_generated_slots(state.tournament_id) as generated
    on generated.play_date = availability.play_date
   and generated.starts_at = availability.starts_at
   and generated.ends_at = availability.ends_at
  group by state.team_id
)
update public.tournament_import_team_availability_state as state
set
  pools_slot_count = phase_counts.pools_slot_count,
  finals_slot_count = phase_counts.finals_slot_count,
  pools_known = phase_counts.pools_slot_count > 0,
  finals_known = phase_counts.finals_slot_count > 0,
  slot_count = phase_counts.pools_slot_count + phase_counts.finals_slot_count
from phase_counts
where phase_counts.team_id = state.team_id;

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
  phases as (
    select
      target.id as tournament_id,
      target.pool_starts_on as starts_on,
      target.pool_ends_on as ends_on,
      target.slot_interval,
      'pools'::text as phase
    from target
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
  ),
  native_slots as (
    select distinct
      date_series.play_timestamp::date as play_date,
      slot_series.starts_at::time as starts_at,
      (slot_series.starts_at + phases.slot_interval)::time as ends_at,
      phases.phase
    from phases
    cross join lateral generate_series(
      phases.starts_on::timestamp,
      phases.ends_on::timestamp,
      interval '1 day'
    ) as date_series(play_timestamp)
    join public.tournament_play_windows as play_window
      on play_window.tournament_id = phases.tournament_id
     and play_window.weekday = extract(dow from date_series.play_timestamp)::integer
    cross join lateral generate_series(
      date_series.play_timestamp::date + play_window.opens_at,
      date_series.play_timestamp::date + play_window.closes_at - phases.slot_interval,
      phases.slot_interval
    ) as slot_series(starts_at)
  )
  select source.play_date, source.starts_at, source.ends_at, source.phase
  from source_slots as source
  union all
  select native.play_date, native.starts_at, native.ends_at, native.phase
  from native_slots as native
  where not exists (
    select 1
    from source_phases as imported_phase
    where imported_phase.phase = native.phase
  )
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
  declaration_exists boolean := false;
  row_count integer := 0;
  source_slot_count integer := 0;
  team_count integer := 0;
  pool_team_count integer := 0;
  finals_team_count integer := 0;
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

  row_index := 0;
  seen_keys := '{}'::text[];
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
        jsonb_build_object('row', row_index, 'code', 'invalid_source_slot', 'message', 'Colonne de créneau Errebot invalide.')
      );
      continue;
    end if;

    begin
      availability_date := play_date_text::date;
      availability_starts_at := starts_at_text::time;
      availability_ends_at := ends_at_text::time;
    exception when others then
      errors := errors || jsonb_build_array(
        jsonb_build_object('row', row_index, 'code', 'invalid_source_slot', 'message', 'Date ou horaire de colonne Errebot impossible à interpréter.')
      );
      continue;
    end;

    if availability_ends_at <= availability_starts_at then
      errors := errors || jsonb_build_array(
        jsonb_build_object('row', row_index, 'code', 'invalid_source_slot', 'message', 'La fin du créneau Errebot doit être après son début.')
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

  if jsonb_typeof(declarations_payload) <> 'array'
     or jsonb_array_length(declarations_payload) = 0 then
    errors := errors || jsonb_build_array(
      jsonb_build_object('row', 0, 'code', 'empty_workbook', 'message', 'Aucune équipe Errebot à importer.')
    );
  else
    row_index := 0;
    seen_keys := '{}'::text[];
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

      if not exists (
        select 1
        from jsonb_array_elements(normalized_source_slots) as source(value)
        where source.value->>'phase' = target_phase
      ) then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'missing_phase_grid', 'message', concat('Aucune colonne de créneau pour la phase ', target_phase, '.'))
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
        jsonb_build_object('external_team_id', external_team_id, 'team_id', mapped_team_id, 'phase', target_phase)
      );
    end loop;
  end if;

  row_index := 0;
  seen_keys := '{}'::text[];
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

      if external_team_id = ''
        or target_phase not in ('pools', 'finals')
        or play_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or starts_at_text !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
        or ends_at_text !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'invalid_row', 'message', 'Équipe, phase, date ou horaire invalide.')
        );
        continue;
      end if;

      begin
        availability_date := play_date_text::date;
        availability_starts_at := starts_at_text::time;
        availability_ends_at := ends_at_text::time;
      exception when others then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'invalid_row', 'message', 'Date ou horaire impossible à interpréter.')
        );
        continue;
      end;

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

      select exists (
        select 1
        from jsonb_array_elements(normalized_declarations) as declaration(value)
        where (declaration.value->>'team_id')::uuid = mapped_team_id
          and declaration.value->>'phase' = target_phase
      ) into declaration_exists;

      if not declaration_exists then
        errors := errors || jsonb_build_array(
          jsonb_build_object('row', row_index, 'code', 'missing_team_phase', 'message', 'Ce créneau ne correspond à aucune ligne équipe de l’onglet concerné.')
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
          jsonb_build_object('row', row_index, 'code', 'unknown_slot', 'message', concat('Le créneau ', play_date_text, ' ', starts_at_text, ' n’existe pas dans les colonnes du classeur Errebot.'))
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

  select count(*)::integer into row_count from jsonb_array_elements(normalized_rows);
  select count(*)::integer into source_slot_count from jsonb_array_elements(normalized_source_slots);
  select count(distinct (value->>'team_id'))::integer into team_count from jsonb_array_elements(normalized_declarations);
  select count(*)::integer into pool_team_count from jsonb_array_elements(normalized_declarations) where value->>'phase' = 'pools';
  select count(*)::integer into finals_team_count from jsonb_array_elements(normalized_declarations) where value->>'phase' = 'finals';

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

create or replace function public.admin_get_errebot_availability_import_context(target_tournament_id uuid)
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
  finals_required boolean := false;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select tournament.* into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id and tournament.club_id = target_club_id;

  if target_tournament.id is null then raise exception 'Tournament not found' using errcode = 'P0002'; end if;

  select import_row.id into target_import_id
  from public.tournament_imports as import_row
  where import_row.tournament_id = target_tournament.id and import_row.source = 'errebot'
  order by import_row.imported_at desc nulls last, import_row.created_at desc limit 1;

  if target_import_id is null then return jsonb_build_object('enabled', false); end if;

  finals_required := (
    target_tournament.finals_starts_on is not null and target_tournament.finals_ends_on is not null
  ) or exists (
    select 1 from public.tournament_import_availability_slots as source
    where source.tournament_id = target_tournament.id and source.phase = 'finals'
  );

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

  return jsonb_build_object(
    'enabled', true,
    'tournament_id', target_tournament.id,
    'tournament_name', target_tournament.name,
    'tournament_status', target_tournament.status,
    'slot_duration_minutes', target_tournament.slot_duration_minutes,
    'accepted_team_count', accepted_team_count,
    'finals_required', finals_required,
    'pools_known_team_count', pools_known_team_count,
    'finals_known_team_count', finals_known_team_count,
    'pools_coverage_complete', accepted_team_count > 0 and pools_known_team_count = accepted_team_count,
    'finals_coverage_complete', not finals_required or (accepted_team_count > 0 and finals_known_team_count = accepted_team_count),
    'coverage_complete', accepted_team_count > 0 and pools_known_team_count = accepted_team_count and (not finals_required or finals_known_team_count = accepted_team_count),
    'teams', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'external_team_id', ref.external_team_id,
        'team_id', team.id,
        'label', public.tournament_team_public_label(team.id),
        'pools_known', coalesce(state.pools_known, false),
        'pools_slot_count', coalesce(state.pools_slot_count, 0),
        'finals_known', coalesce(state.finals_known, false),
        'finals_slot_count', coalesce(state.finals_slot_count, 0)
      ) order by ref.external_team_id), '[]'::jsonb)
      from public.tournament_import_team_refs as ref
      join public.tournament_teams as team on team.id = ref.team_id
      left join public.tournament_import_team_availability_state as state on state.team_id = team.id
      where ref.import_id = target_import_id and team.status = 'accepted'
    )
  );
end;
$$;

create or replace function public.admin_preview_errebot_availability_import(target_tournament_id uuid, payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  target_tournament public.tournaments;
  validation jsonb;
  accepted_team_count integer := 0;
  pools_known_before integer := 0;
  finals_known_before integer := 0;
  new_pools integer := 0;
  new_finals integer := 0;
  pools_known_after integer := 0;
  finals_known_after integer := 0;
  finals_required boolean := false;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then raise exception 'Forbidden' using errcode = '42501'; end if;
  select tournament.* into target_tournament from public.tournaments as tournament where tournament.id = target_tournament_id and tournament.club_id = target_club_id;
  if target_tournament.id is null then raise exception 'Tournament not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.tournament_imports as import_row where import_row.tournament_id = target_tournament.id and import_row.source = 'errebot') then raise exception 'Tournament is not an Errebot import' using errcode = 'P0001'; end if;

  validation := public.validate_errebot_availability_import_payload(target_tournament.id, payload);
  finals_required := (
    target_tournament.finals_starts_on is not null and target_tournament.finals_ends_on is not null
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(validation->'normalized_source_slots', '[]'::jsonb)) as source(value)
    where source.value->>'phase' = 'finals'
  ) or exists (
    select 1 from public.tournament_import_availability_slots as source where source.tournament_id = target_tournament.id and source.phase = 'finals'
  );

  select count(*)::integer into accepted_team_count from public.tournament_teams as team where team.tournament_id = target_tournament.id and team.status = 'accepted';
  select count(*) filter (where state.pools_known)::integer, count(*) filter (where state.finals_known)::integer
  into pools_known_before, finals_known_before
  from public.tournament_import_team_availability_state as state
  join public.tournament_teams as team on team.id = state.team_id
  where state.tournament_id = target_tournament.id and team.status = 'accepted';

  select count(*)::integer into new_pools
  from jsonb_array_elements(coalesce(validation->'normalized_declarations', '[]'::jsonb)) as declaration(value)
  left join public.tournament_import_team_availability_state as state on state.team_id = (declaration.value->>'team_id')::uuid
  where declaration.value->>'phase' = 'pools' and coalesce(state.pools_known, false) is false;

  select count(*)::integer into new_finals
  from jsonb_array_elements(coalesce(validation->'normalized_declarations', '[]'::jsonb)) as declaration(value)
  left join public.tournament_import_team_availability_state as state on state.team_id = (declaration.value->>'team_id')::uuid
  where declaration.value->>'phase' = 'finals' and coalesce(state.finals_known, false) is false;

  pools_known_after := least(pools_known_before + coalesce(new_pools, 0), accepted_team_count);
  finals_known_after := least(finals_known_before + coalesce(new_finals, 0), accepted_team_count);

  return validation || jsonb_build_object(
    'accepted_team_count', accepted_team_count,
    'pools_known_team_count_before', pools_known_before,
    'pools_known_team_count_after', pools_known_after,
    'finals_known_team_count_before', finals_known_before,
    'finals_known_team_count_after', finals_known_after,
    'pools_coverage_complete_after', accepted_team_count > 0 and pools_known_after = accepted_team_count,
    'finals_coverage_complete_after', not finals_required or (accepted_team_count > 0 and finals_known_after = accepted_team_count),
    'coverage_complete_after', accepted_team_count > 0 and pools_known_after = accepted_team_count and (not finals_required or finals_known_after = accepted_team_count)
  );
end;
$$;

create or replace function public.admin_import_errebot_availability(target_tournament_id uuid, payload jsonb)
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
  declaration record;
  target_phase text;
  phase_slot_count integer := 0;
  imported_team_count integer := 0;
  imported_slot_count integer := 0;
  source_slot_count integer := 0;
  accepted_team_count integer := 0;
  pools_known_team_count integer := 0;
  finals_known_team_count integer := 0;
  finals_required boolean := false;
  has_previous_source_grid boolean := false;
begin
  if not public.has_club_permission(target_club_id, 'tournaments.manage') then raise exception 'Forbidden' using errcode = '42501'; end if;
  select tournament.* into target_tournament from public.tournaments as tournament where tournament.id = target_tournament_id and tournament.club_id = target_club_id for update;
  if target_tournament.id is null then raise exception 'Tournament not found' using errcode = 'P0002'; end if;
  if target_tournament.status in ('completed', 'archived', 'cancelled') then raise exception 'Tournament availability cannot be imported at this stage' using errcode = 'P0001'; end if;

  select import_row.id into target_import_id from public.tournament_imports as import_row
  where import_row.tournament_id = target_tournament.id and import_row.source = 'errebot'
  order by import_row.imported_at desc nulls last, import_row.created_at desc limit 1;
  if target_import_id is null then raise exception 'Tournament is not an Errebot import' using errcode = 'P0001'; end if;

  validation := public.validate_errebot_availability_import_payload(target_tournament.id, payload);
  if coalesce((validation->>'valid')::boolean, false) is not true then raise exception 'Errebot availability import is invalid' using errcode = '22023'; end if;

  normalized_rows := coalesce(validation->'normalized_rows', '[]'::jsonb);
  normalized_declarations := coalesce(validation->'normalized_declarations', '[]'::jsonb);
  normalized_source_slots := coalesce(validation->'normalized_source_slots', '[]'::jsonb);

  select exists (select 1 from public.tournament_import_availability_slots as source where source.tournament_id = target_tournament.id) into has_previous_source_grid;

  if not has_previous_source_grid then
    delete from public.tournament_team_availability_slots as availability
    where availability.tournament_id = target_tournament.id
      and availability.team_id in (
        select distinct (declaration.value->>'team_id')::uuid
        from jsonb_array_elements(normalized_declarations) as declaration(value)
      );
  else
    for declaration in
      select (value->>'team_id')::uuid as team_id, value->>'phase' as phase
      from jsonb_array_elements(normalized_declarations)
    loop
      delete from public.tournament_team_availability_slots as availability
      where availability.tournament_id = target_tournament.id
        and availability.team_id = declaration.team_id
        and exists (
          select 1 from public.tournament_generated_slots(target_tournament.id) as generated
          where generated.phase = declaration.phase
            and generated.play_date = availability.play_date
            and generated.starts_at = availability.starts_at
            and generated.ends_at = availability.ends_at
        );
    end loop;
  end if;

  for target_phase in select distinct value->>'phase' from jsonb_array_elements(normalized_source_slots)
  loop
    delete from public.tournament_import_availability_slots as source where source.tournament_id = target_tournament.id and source.phase = target_phase;
    insert into public.tournament_import_availability_slots (tournament_id, import_id, phase, play_date, starts_at, ends_at, source_slot_id)
    select target_tournament.id, target_import_id, target_phase, (source.value->>'play_date')::date, (source.value->>'starts_at')::time, (source.value->>'ends_at')::time, nullif(source.value->>'source_slot_id', '')
    from jsonb_array_elements(normalized_source_slots) as source(value)
    where source.value->>'phase' = target_phase;
  end loop;

  for declaration in
    select (value->>'team_id')::uuid as team_id, value->>'phase' as phase
    from jsonb_array_elements(normalized_declarations)
  loop
    insert into public.tournament_team_availability_slots (team_id, tournament_id, play_date, starts_at, ends_at)
    select declaration.team_id, target_tournament.id, (row.value->>'play_date')::date, (row.value->>'starts_at')::time, (row.value->>'ends_at')::time
    from jsonb_array_elements(normalized_rows) as row(value)
    where (row.value->>'team_id')::uuid = declaration.team_id and row.value->>'phase' = declaration.phase
    on conflict do nothing;

    select count(*)::integer into phase_slot_count from jsonb_array_elements(normalized_rows) as row(value)
    where (row.value->>'team_id')::uuid = declaration.team_id and row.value->>'phase' = declaration.phase;

    insert into public.tournament_import_team_availability_state as state (
      team_id, tournament_id, import_id, slot_count, pools_known, finals_known, pools_slot_count, finals_slot_count, imported_by, imported_at
    ) values (
      declaration.team_id, target_tournament.id, target_import_id, phase_slot_count,
      declaration.phase = 'pools', declaration.phase = 'finals',
      case when declaration.phase = 'pools' then phase_slot_count else 0 end,
      case when declaration.phase = 'finals' then phase_slot_count else 0 end,
      auth.uid(), now()
    ) on conflict (team_id) do update set
      tournament_id = excluded.tournament_id,
      import_id = excluded.import_id,
      pools_known = case when declaration.phase = 'pools' then true else state.pools_known end,
      finals_known = case when declaration.phase = 'finals' then true else state.finals_known end,
      pools_slot_count = case when declaration.phase = 'pools' then phase_slot_count else state.pools_slot_count end,
      finals_slot_count = case when declaration.phase = 'finals' then phase_slot_count else state.finals_slot_count end,
      slot_count = (case when declaration.phase = 'pools' then phase_slot_count else state.pools_slot_count end) + (case when declaration.phase = 'finals' then phase_slot_count else state.finals_slot_count end),
      imported_by = excluded.imported_by,
      imported_at = excluded.imported_at;
  end loop;

  select count(distinct (value->>'team_id'))::integer into imported_team_count from jsonb_array_elements(normalized_declarations);
  imported_slot_count := jsonb_array_length(normalized_rows);
  source_slot_count := jsonb_array_length(normalized_source_slots);
  finals_required := (target_tournament.finals_starts_on is not null and target_tournament.finals_ends_on is not null)
    or exists (select 1 from public.tournament_import_availability_slots as source where source.tournament_id = target_tournament.id and source.phase = 'finals');

  select count(*)::integer into accepted_team_count from public.tournament_teams as team where team.tournament_id = target_tournament.id and team.status = 'accepted';
  select count(*) filter (where state.pools_known)::integer, count(*) filter (where state.finals_known)::integer
  into pools_known_team_count, finals_known_team_count
  from public.tournament_import_team_availability_state as state
  join public.tournament_teams as team on team.id = state.team_id
  where state.tournament_id = target_tournament.id and team.status = 'accepted';

  insert into public.tournament_audit_log (tournament_id, action, before_status, after_status, payload, created_by)
  values (
    target_tournament.id, 'errebot_availability_imported', target_tournament.status, target_tournament.status,
    jsonb_build_object(
      'team_count', imported_team_count, 'slot_count', imported_slot_count, 'source_slot_count', source_slot_count,
      'pools_known_team_count', pools_known_team_count, 'finals_known_team_count', finals_known_team_count,
      'accepted_team_count', accepted_team_count,
      'pools_coverage_complete', accepted_team_count > 0 and pools_known_team_count = accepted_team_count,
      'finals_coverage_complete', not finals_required or (accepted_team_count > 0 and finals_known_team_count = accepted_team_count)
    ), auth.uid()
  );

  return jsonb_build_object(
    'imported_team_count', imported_team_count, 'imported_slot_count', imported_slot_count, 'source_slot_count', source_slot_count,
    'accepted_team_count', accepted_team_count, 'pools_known_team_count', pools_known_team_count, 'finals_known_team_count', finals_known_team_count,
    'pools_coverage_complete', accepted_team_count > 0 and pools_known_team_count = accepted_team_count,
    'finals_coverage_complete', not finals_required or (accepted_team_count > 0 and finals_known_team_count = accepted_team_count),
    'coverage_complete', accepted_team_count > 0 and pools_known_team_count = accepted_team_count and (not finals_required or finals_known_team_count = accepted_team_count)
  );
end;
$$;

revoke all on function public.admin_get_errebot_availability_import_context(uuid) from public, anon, authenticated;
revoke all on function public.admin_preview_errebot_availability_import(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_import_errebot_availability(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_get_errebot_availability_import_context(uuid) to authenticated;
grant execute on function public.admin_preview_errebot_availability_import(uuid, jsonb) to authenticated;
grant execute on function public.admin_import_errebot_availability(uuid, jsonb) to authenticated;

create or replace function public.get_my_tournament_reschedule_options(target_match_id uuid, requester_team_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  target_tournament_id uuid;
  target_phase text := 'pools';
  is_errebot_import boolean := false;
  has_native_availability boolean := false;
  accepted_team_count integer := 0;
  known_team_count integer := 0;
  coverage_complete boolean := false;
  restrict_swaps boolean := false;
begin
  result := public.get_my_tournament_reschedule_options_engine(target_match_id, requester_team_id);
  select match.tournament_id, match.phase::text into target_tournament_id, target_phase from public.tournament_matches as match where match.id = target_match_id;
  select exists (select 1 from public.tournament_imports as import_row where import_row.tournament_id = target_tournament_id and import_row.source = 'errebot') into is_errebot_import;
  select exists (
    select 1 from public.tournament_team_availability_slots as availability
    join public.tournament_generated_slots(target_tournament_id) as generated
      on generated.play_date = availability.play_date and generated.starts_at = availability.starts_at and generated.ends_at = availability.ends_at and generated.phase = target_phase
    where availability.tournament_id = target_tournament_id
  ) into has_native_availability;

  if is_errebot_import then
    select count(*)::integer into accepted_team_count from public.tournament_teams as team where team.tournament_id = target_tournament_id and team.status = 'accepted';
    select count(*)::integer into known_team_count
    from public.tournament_import_team_availability_state as state
    join public.tournament_teams as team on team.id = state.team_id
    where state.tournament_id = target_tournament_id and team.status = 'accepted'
      and case when target_phase = 'finals' then state.finals_known else state.pools_known end;
    coverage_complete := accepted_team_count > 0 and known_team_count = accepted_team_count;
  end if;

  restrict_swaps := is_errebot_import and not coverage_complete;
  result := jsonb_set(result, '{policy}', coalesce(result->'policy', '{}'::jsonb) || jsonb_build_object(
    'swaps_enabled', not restrict_swaps,
    'availability_phase', target_phase,
    'availability_source', case when is_errebot_import and coverage_complete then 'errebot_imported' when is_errebot_import and known_team_count > 0 then 'partial_from_errebot' when is_errebot_import then 'unknown_from_errebot' when has_native_availability then 'declared' else 'not_required' end,
    'availability_known_team_count', known_team_count,
    'availability_team_count', accepted_team_count,
    'availability_coverage_complete', coverage_complete,
    'swap_restriction_reason', case when restrict_swaps then 'errebot_availability_incomplete' else null end
  ), true);
  if restrict_swaps then result := jsonb_set(result, '{swaps}', '[]'::jsonb, true); end if;
  return result;
end;
$$;

revoke all on function public.get_my_tournament_reschedule_options(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_my_tournament_reschedule_options(uuid, uuid) to authenticated;

commit;
