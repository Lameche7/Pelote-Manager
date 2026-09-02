begin;

-- PR127 — import différé des disponibilités Errebot.
--
-- Le planning importé reste inchangé. Les disponibilités sont rattachées aux
-- équipes Errebot déjà créées et servent uniquement aux futures propositions de
-- report. Une disponibilité absente reste « inconnue » tant que toutes les
-- équipes n'ont pas été couvertes par un import administrateur.

create table if not exists public.tournament_import_team_availability_state (
  team_id uuid primary key references public.tournament_teams (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  import_id uuid not null references public.tournament_imports (id) on delete cascade,
  slot_count integer not null default 0 check (slot_count >= 0),
  imported_by uuid references public.profiles (id) on delete set null default auth.uid(),
  imported_at timestamptz not null default now(),
  check (team_id is not null)
);

create index if not exists tournament_import_team_availability_state_tournament_idx
on public.tournament_import_team_availability_state (tournament_id);

alter table public.tournament_import_team_availability_state enable row level security;
revoke all on table public.tournament_import_team_availability_state
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
  item jsonb;
  normalized_rows jsonb := '[]'::jsonb;
  errors jsonb := '[]'::jsonb;
  row_index integer := 0;
  external_team_id text;
  play_date_text text;
  starts_at_text text;
  ends_at_text text;
  availability_date date;
  availability_starts_at time;
  availability_ends_at time;
  mapped_team_id uuid;
  slot_key text;
  seen_keys text[] := '{}'::text[];
  team_count integer := 0;
  row_count integer := 0;
  slot_interval interval;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(rows_payload) <> 'array' or jsonb_array_length(rows_payload) = 0 then
    return jsonb_build_object(
      'valid', false,
      'row_count', 0,
      'team_count', 0,
      'normalized_rows', '[]'::jsonb,
      'errors', jsonb_build_array(
        jsonb_build_object(
          'row', 0,
          'code', 'empty_file',
          'message', 'Aucune disponibilité à importer.'
        )
      )
    );
  end if;

  slot_interval := make_interval(mins => target_tournament.slot_duration_minutes);

  for item in select value from jsonb_array_elements(rows_payload)
  loop
    row_index := row_index + 1;
    external_team_id := btrim(coalesce(item->>'external_team_id', ''));
    play_date_text := btrim(coalesce(item->>'play_date', ''));
    starts_at_text := btrim(coalesce(item->>'starts_at', ''));
    ends_at_text := btrim(coalesce(item->>'ends_at', ''));
    mapped_team_id := null;

    if external_team_id = ''
      or play_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or starts_at_text !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$'
      or (ends_at_text <> '' and ends_at_text !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$') then
      errors := errors || jsonb_build_array(
        jsonb_build_object(
          'row', row_index,
          'code', 'invalid_row',
          'message', 'Numéro d''équipe, date ou horaire invalide.'
        )
      );
      continue;
    end if;

    begin
      availability_date := play_date_text::date;
      availability_starts_at := starts_at_text::time;
      availability_ends_at := case
        when ends_at_text = '' then availability_starts_at + slot_interval
        else ends_at_text::time
      end;
    exception when others then
      errors := errors || jsonb_build_array(
        jsonb_build_object(
          'row', row_index,
          'code', 'invalid_row',
          'message', 'Date ou horaire impossible à interpréter.'
        )
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
        jsonb_build_object(
          'row', row_index,
          'code', 'unknown_team',
          'message', concat('Équipe Errebot ', external_team_id, ' introuvable ou inactive.')
        )
      );
      continue;
    end if;

    if not exists (
      select 1
      from public.tournament_generated_slots(target_tournament_id) as generated
      where generated.play_date = availability_date
        and generated.starts_at = availability_starts_at
        and generated.ends_at = availability_ends_at
    ) then
      errors := errors || jsonb_build_array(
        jsonb_build_object(
          'row', row_index,
          'code', 'unknown_slot',
          'message', concat(
            'Le créneau ', play_date_text, ' ', starts_at_text,
            ' ne fait pas partie de la grille du tournoi.'
          )
        )
      );
      continue;
    end if;

    slot_key := concat(
      mapped_team_id,
      '|',
      availability_date,
      '|',
      availability_starts_at,
      '|',
      availability_ends_at
    );

    if slot_key = any(seen_keys) then
      errors := errors || jsonb_build_array(
        jsonb_build_object(
          'row', row_index,
          'code', 'duplicate_slot',
          'message', concat('Créneau en doublon pour l''équipe ', external_team_id, '.')
        )
      );
      continue;
    end if;

    seen_keys := array_append(seen_keys, slot_key);
    normalized_rows := normalized_rows || jsonb_build_array(
      jsonb_build_object(
        'external_team_id', external_team_id,
        'team_id', mapped_team_id,
        'play_date', availability_date,
        'starts_at', availability_starts_at,
        'ends_at', availability_ends_at
      )
    );
  end loop;

  select count(*)::integer
  into row_count
  from jsonb_array_elements(normalized_rows);

  select count(distinct value->>'team_id')::integer
  into team_count
  from jsonb_array_elements(normalized_rows);

  return jsonb_build_object(
    'valid', jsonb_array_length(errors) = 0,
    'row_count', row_count,
    'team_count', team_count,
    'normalized_rows', normalized_rows,
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
  known_team_count integer := 0;
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

  select count(*)::integer
  into known_team_count
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
    'known_team_count', known_team_count,
    'coverage_complete', accepted_team_count > 0 and known_team_count = accepted_team_count,
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'external_team_id', ref.external_team_id,
            'team_id', team.id,
            'label', public.tournament_team_public_label(team.id),
            'availability_known', state.team_id is not null,
            'slot_count', coalesce(state.slot_count, 0)
          )
          order by ref.external_team_id
        ),
        '[]'::jsonb
      )
      from public.tournament_import_team_refs as ref
      join public.tournament_teams as team on team.id = ref.team_id
      left join public.tournament_import_team_availability_state as state
        on state.team_id = team.id
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
  target_tournament public.tournaments;
  validation jsonb;
  current_known_count integer := 0;
  accepted_team_count integer := 0;
  new_team_count integer := 0;
  coverage_after integer := 0;
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

  if not exists (
    select 1
    from public.tournament_imports as import_row
    where import_row.tournament_id = target_tournament.id
      and import_row.source = 'errebot'
  ) then
    raise exception 'Tournament is not an Errebot import' using errcode = 'P0001';
  end if;

  validation := public.validate_errebot_availability_import_payload(
    target_tournament.id,
    payload
  );

  select count(*)::integer
  into accepted_team_count
  from public.tournament_teams as team
  where team.tournament_id = target_tournament.id
    and team.status = 'accepted';

  select count(*)::integer
  into current_known_count
  from public.tournament_import_team_availability_state as state
  join public.tournament_teams as team on team.id = state.team_id
  where state.tournament_id = target_tournament.id
    and team.status = 'accepted';

  select count(distinct (row.value->>'team_id'))::integer
  into new_team_count
  from jsonb_array_elements(coalesce(validation->'normalized_rows', '[]'::jsonb)) as row(value)
  where not exists (
    select 1
    from public.tournament_import_team_availability_state as state
    where state.team_id = (row.value->>'team_id')::uuid
  );

  coverage_after := least(current_known_count + coalesce(new_team_count, 0), accepted_team_count);

  return validation || jsonb_build_object(
    'accepted_team_count', accepted_team_count,
    'known_team_count_before', current_known_count,
    'known_team_count_after', coverage_after,
    'coverage_complete_after', accepted_team_count > 0 and coverage_after = accepted_team_count
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
  target_team_id uuid;
  imported_team_count integer := 0;
  imported_slot_count integer := 0;
  accepted_team_count integer := 0;
  known_team_count integer := 0;
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

  for target_team_id in
    select distinct (row.value->>'team_id')::uuid
    from jsonb_array_elements(normalized_rows) as row(value)
  loop
    delete from public.tournament_team_availability_slots as availability
    where availability.tournament_id = target_tournament.id
      and availability.team_id = target_team_id;

    insert into public.tournament_team_availability_slots (
      team_id,
      tournament_id,
      play_date,
      starts_at,
      ends_at
    )
    select
      target_team_id,
      target_tournament.id,
      (row.value->>'play_date')::date,
      (row.value->>'starts_at')::time,
      (row.value->>'ends_at')::time
    from jsonb_array_elements(normalized_rows) as row(value)
    where (row.value->>'team_id')::uuid = target_team_id;

    insert into public.tournament_import_team_availability_state (
      team_id,
      tournament_id,
      import_id,
      slot_count,
      imported_by,
      imported_at
    )
    values (
      target_team_id,
      target_tournament.id,
      target_import_id,
      (
        select count(*)::integer
        from jsonb_array_elements(normalized_rows) as row(value)
        where (row.value->>'team_id')::uuid = target_team_id
      ),
      auth.uid(),
      now()
    )
    on conflict (team_id) do update
    set
      tournament_id = excluded.tournament_id,
      import_id = excluded.import_id,
      slot_count = excluded.slot_count,
      imported_by = excluded.imported_by,
      imported_at = excluded.imported_at;

    imported_team_count := imported_team_count + 1;
  end loop;

  imported_slot_count := jsonb_array_length(normalized_rows);

  select count(*)::integer
  into accepted_team_count
  from public.tournament_teams as team
  where team.tournament_id = target_tournament.id
    and team.status = 'accepted';

  select count(*)::integer
  into known_team_count
  from public.tournament_import_team_availability_state as state
  join public.tournament_teams as team on team.id = state.team_id
  where state.tournament_id = target_tournament.id
    and team.status = 'accepted';

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament.id,
    'errebot_availability_imported',
    target_tournament.status,
    target_tournament.status,
    jsonb_build_object(
      'team_count', imported_team_count,
      'slot_count', imported_slot_count,
      'known_team_count', known_team_count,
      'accepted_team_count', accepted_team_count,
      'coverage_complete', accepted_team_count > 0 and known_team_count = accepted_team_count
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'imported_team_count', imported_team_count,
    'imported_slot_count', imported_slot_count,
    'known_team_count', known_team_count,
    'accepted_team_count', accepted_team_count,
    'coverage_complete', accepted_team_count > 0 and known_team_count = accepted_team_count
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

-- Le wrapper de report ne réactive les échanges Errebot que lorsque les
-- disponibilités sont connues pour toutes les équipes encore inscrites.
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
  has_native_availability boolean := false;
  accepted_team_count integer := 0;
  known_team_count integer := 0;
  coverage_complete boolean := false;
  restrict_swaps boolean := false;
begin
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
    where availability.tournament_id = target_tournament_id
  )
  into has_native_availability;

  if is_errebot_import then
    select count(*)::integer
    into accepted_team_count
    from public.tournament_teams as team
    where team.tournament_id = target_tournament_id
      and team.status = 'accepted';

    select count(*)::integer
    into known_team_count
    from public.tournament_import_team_availability_state as state
    join public.tournament_teams as team on team.id = state.team_id
    where state.tournament_id = target_tournament_id
      and team.status = 'accepted';

    coverage_complete := accepted_team_count > 0 and known_team_count = accepted_team_count;
  end if;

  restrict_swaps := is_errebot_import and not coverage_complete;

  result := jsonb_set(
    result,
    '{policy}',
    coalesce(result->'policy', '{}'::jsonb) || jsonb_build_object(
      'swaps_enabled', not restrict_swaps,
      'availability_source', case
        when is_errebot_import and coverage_complete then 'errebot_imported'
        when is_errebot_import and known_team_count > 0 then 'partial_from_errebot'
        when is_errebot_import then 'unknown_from_errebot'
        when has_native_availability then 'declared'
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
