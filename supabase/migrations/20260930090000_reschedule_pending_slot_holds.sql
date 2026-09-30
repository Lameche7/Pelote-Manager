begin;

create or replace function public.tournament_reschedule_slot_is_held(
  target_resource_id uuid,
  target_play_date date,
  target_starts_at time without time zone,
  target_ends_at time without time zone,
  excluded_request_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tournament_reschedule_requests as request
    where request.status in ('pending', 'approved')
      and request.expires_at > now()
      and request.id is distinct from excluded_request_id
      and request.target_resource_id = target_resource_id
      and request.target_play_date = target_play_date
      and request.target_starts_at < target_ends_at
      and request.target_ends_at > target_starts_at
  );
$function$;

revoke all on function public.tournament_reschedule_slot_is_held(
  uuid, date, time without time zone, time without time zone, uuid
) from public, anon, authenticated;

do $migration$
begin
  if to_regprocedure(
    'public.get_my_tournament_reschedule_options_unfiltered(uuid,uuid)'
  ) is null then
    alter function public.get_my_tournament_reschedule_options(uuid, uuid)
      rename to get_my_tournament_reschedule_options_unfiltered;
  end if;

  if to_regprocedure(
    'public.admin_get_tournament_manual_reschedule_slots_unfiltered(uuid)'
  ) is null then
    alter function public.admin_get_tournament_manual_reschedule_slots(uuid)
      rename to admin_get_tournament_manual_reschedule_slots_unfiltered;
  end if;
end;
$migration$;

revoke all on function public.get_my_tournament_reschedule_options_unfiltered(
  uuid, uuid
) from public, anon, authenticated;

revoke all on function public.admin_get_tournament_manual_reschedule_slots_unfiltered(
  uuid
) from public, anon, authenticated;

create or replace function public.get_my_tournament_reschedule_options(
  target_match_id uuid,
  requester_team_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  filtered_free_slots jsonb;
  filtered_swaps jsonb;
begin
  result := public.get_my_tournament_reschedule_options_unfiltered(
    target_match_id,
    requester_team_id
  );

  select coalesce(jsonb_agg(item.value), '[]'::jsonb)
  into filtered_free_slots
  from jsonb_array_elements(
    coalesce(result->'free_slots', '[]'::jsonb)
  ) as item(value)
  where not public.tournament_reschedule_slot_is_held(
    nullif(item.value->>'resource_id', '')::uuid,
    nullif(item.value->>'play_date', '')::date,
    nullif(item.value->>'starts_at', '')::time,
    nullif(item.value->>'ends_at', '')::time
  );

  select coalesce(jsonb_agg(item.value), '[]'::jsonb)
  into filtered_swaps
  from jsonb_array_elements(
    coalesce(result->'swaps', '[]'::jsonb)
  ) as item(value)
  where not public.tournament_reschedule_slot_is_held(
    nullif(item.value->>'resource_id', '')::uuid,
    nullif(item.value->>'play_date', '')::date,
    nullif(item.value->>'starts_at', '')::time,
    nullif(item.value->>'ends_at', '')::time
  )
    and not exists (
      select 1
      from public.tournament_reschedule_active_matches as active
      where active.match_id = nullif(item.value->>'swap_match_id', '')::uuid
    );

  return jsonb_set(
    jsonb_set(
      coalesce(result, '{}'::jsonb),
      '{free_slots}',
      filtered_free_slots,
      true
    ),
    '{swaps}',
    filtered_swaps,
    true
  );
end;
$function$;

revoke all on function public.get_my_tournament_reschedule_options(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_my_tournament_reschedule_options(uuid, uuid)
  to authenticated;

create or replace function public.admin_get_tournament_manual_reschedule_slots(
  target_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  result := public.admin_get_tournament_manual_reschedule_slots_unfiltered(
    target_match_id
  );

  return coalesce(
    (
      select jsonb_agg(item.value)
      from jsonb_array_elements(coalesce(result, '[]'::jsonb)) as item(value)
      where not public.tournament_reschedule_slot_is_held(
        nullif(item.value->>'resource_id', '')::uuid,
        nullif(item.value->>'play_date', '')::date,
        nullif(item.value->>'starts_at', '')::time,
        nullif(item.value->>'ends_at', '')::time
      )
    ),
    '[]'::jsonb
  );
end;
$function$;

revoke all on function public.admin_get_tournament_manual_reschedule_slots(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_get_tournament_manual_reschedule_slots(uuid)
  to authenticated;

create or replace function public.guard_tournament_reschedule_target_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status not in ('pending', 'approved')
    or new.target_resource_id is null
    or new.target_play_date is null
    or new.target_starts_at is null
    or new.target_ends_at is null
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'tournament-reschedule-slot:'
        || new.target_resource_id::text
        || ':'
        || new.target_play_date::text,
      0
    )
  );

  if public.tournament_reschedule_slot_is_held(
    new.target_resource_id,
    new.target_play_date,
    new.target_starts_at,
    new.target_ends_at,
    new.id
  ) then
    raise exception 'Tournament reschedule target slot already has an active request'
      using errcode = '23505';
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_tournament_reschedule_target_slot()
  from public, anon, authenticated;

drop trigger if exists guard_tournament_reschedule_target_slot
  on public.tournament_reschedule_requests;

create trigger guard_tournament_reschedule_target_slot
before insert or update of
  status,
  target_resource_id,
  target_play_date,
  target_starts_at,
  target_ends_at
on public.tournament_reschedule_requests
for each row
execute function public.guard_tournament_reschedule_target_slot();

commit;
