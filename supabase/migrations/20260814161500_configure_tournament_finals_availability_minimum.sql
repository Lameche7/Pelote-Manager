begin;

-- Rend le minimum de disponibilités de phase finale configurable par tournoi.
alter table public.tournaments
add column if not exists minimum_finals_availability_slots integer not null default 35;

alter table public.tournaments
drop constraint if exists tournaments_minimum_finals_availability_slots_check;

alter table public.tournaments
add constraint tournaments_minimum_finals_availability_slots_check
check (minimum_finals_availability_slots >= 0);

create or replace function public.tournament_team_finals_availability_is_valid(
  target_team_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_team public.tournament_teams;
  target_tournament public.tournaments;
  selected_finals_count integer := 0;
begin
  select team.*
  into target_team
  from public.tournament_teams as team
  where team.id = target_team_id;

  if target_team.id is null
    or target_team.status not in ('pending', 'accepted') then
    return true;
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_team.tournament_id;

  if target_tournament.id is null
    or target_tournament.finals_starts_on is null
    or target_tournament.finals_ends_on is null then
    return true;
  end if;

  select count(*)::integer
  into selected_finals_count
  from public.tournament_team_availability_slots as availability
  join public.tournament_generated_slots(target_tournament.id) as generated
    on generated.play_date = availability.play_date
   and generated.starts_at = availability.starts_at
   and generated.ends_at = availability.ends_at
  where availability.team_id = target_team.id
    and availability.tournament_id = target_tournament.id
    and generated.phase = 'finals';

  return selected_finals_count >= target_tournament.minimum_finals_availability_slots;
end;
$$;

create or replace function public.admin_get_tournament_with_finals_minimum(
  target_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_payload jsonb;
  target_minimum integer;
begin
  base_payload := public.admin_get_tournament(target_id);

  select tournament.minimum_finals_availability_slots
  into target_minimum
  from public.tournaments as tournament
  where tournament.id = target_id;

  return base_payload || jsonb_build_object(
    'minimum_finals_availability_slots',
    coalesce(target_minimum, 35)
  );
end;
$$;

create or replace function public.admin_create_tournament_with_finals_minimum(
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  target_minimum integer := coalesce(
    nullif(payload->>'minimum_finals_availability_slots', '')::integer,
    35
  );
begin
  if target_minimum < 0 then
    raise exception 'Tournament availability settings are invalid'
      using errcode = '22023';
  end if;

  target_id := public.admin_create_tournament(payload);

  update public.tournaments
  set
    minimum_finals_availability_slots = target_minimum,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id;

  return target_id;
end;
$$;

create or replace function public.admin_update_tournament_with_finals_minimum(
  target_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_minimum integer := coalesce(
    nullif(payload->>'minimum_finals_availability_slots', '')::integer,
    35
  );
  previous_minimum integer;
begin
  if target_minimum < 0 then
    raise exception 'Tournament availability settings are invalid'
      using errcode = '22023';
  end if;

  select tournament.minimum_finals_availability_slots
  into previous_minimum
  from public.tournaments as tournament
  where tournament.id = target_id;

  perform public.admin_update_tournament(target_id, payload);

  update public.tournaments
  set
    minimum_finals_availability_slots = target_minimum,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id;

  if previous_minimum is distinct from target_minimum then
    insert into public.tournament_audit_log (
      tournament_id,
      action,
      payload,
      created_by
    )
    values (
      target_id,
      'finals_availability_minimum_updated',
      jsonb_build_object(
        'before', previous_minimum,
        'after', target_minimum
      ),
      auth.uid()
    );
  end if;
end;
$$;

create or replace function public.get_public_tournament_availability_grid_with_finals_minimum(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_payload jsonb;
  target_minimum integer;
begin
  base_payload := public.get_public_tournament_availability_grid(target_tournament_id);
  if base_payload is null then
    return null;
  end if;

  select tournament.minimum_finals_availability_slots
  into target_minimum
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  return base_payload || jsonb_build_object(
    'minimum_finals',
    coalesce(target_minimum, 35)
  );
end;
$$;

create or replace function public.admin_get_tournament_dated_availability_with_finals_minimum(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_payload jsonb;
  target_minimum integer;
begin
  base_payload := public.admin_get_tournament_dated_availability(target_tournament_id);

  select tournament.minimum_finals_availability_slots
  into target_minimum
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  return base_payload || jsonb_build_object(
    'minimum_finals',
    coalesce(target_minimum, 35)
  );
end;
$$;

create or replace function public.generate_tournament_test_data(
  target_tournament_id uuid,
  target_teams_per_series integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
  result jsonb;
  target_batch_id uuid;
  available_finals_count integer := 0;
  selected_finals_count integer := 0;
  missing_finals_count integer := 0;
  test_team record;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.finals_starts_on is not null
    and target_tournament.finals_ends_on is not null then
    select count(*)::integer
    into available_finals_count
    from public.tournament_generated_slots(target_tournament.id) as generated
    where generated.phase = 'finals';

    if available_finals_count < target_tournament.minimum_finals_availability_slots then
      raise exception 'Tournament does not contain enough finals slots for test registrations'
        using errcode = 'P0001';
    end if;
  end if;

  result := public.generate_tournament_test_data_phase_aware_legacy(
    target_tournament_id,
    target_teams_per_series
  );

  target_batch_id := nullif(result->>'batch_id', '')::uuid;

  if target_batch_id is not null
    and target_tournament.finals_starts_on is not null
    and target_tournament.finals_ends_on is not null then
    for test_team in
      select link.team_id
      from public.tournament_test_data_teams as link
      where link.batch_id = target_batch_id
    loop
      select count(*)::integer
      into selected_finals_count
      from public.tournament_team_availability_slots as availability
      join public.tournament_generated_slots(target_tournament.id) as generated
        on generated.play_date = availability.play_date
       and generated.starts_at = availability.starts_at
       and generated.ends_at = availability.ends_at
      where availability.team_id = test_team.team_id
        and availability.tournament_id = target_tournament.id
        and generated.phase = 'finals';

      missing_finals_count := greatest(
        target_tournament.minimum_finals_availability_slots - selected_finals_count,
        0
      );

      if missing_finals_count > 0 then
        insert into public.tournament_team_availability_slots (
          team_id,
          tournament_id,
          play_date,
          starts_at,
          ends_at
        )
        select
          test_team.team_id,
          target_tournament.id,
          generated.play_date,
          generated.starts_at,
          generated.ends_at
        from public.tournament_generated_slots(target_tournament.id) as generated
        where generated.phase = 'finals'
          and not exists (
            select 1
            from public.tournament_team_availability_slots as selected
            where selected.team_id = test_team.team_id
              and selected.tournament_id = target_tournament.id
              and selected.play_date = generated.play_date
              and selected.starts_at = generated.starts_at
              and selected.ends_at = generated.ends_at
          )
        order by random()
        limit missing_finals_count;
      end if;

      perform public.assert_tournament_team_finals_availability(test_team.team_id);
    end loop;
  end if;

  return result || jsonb_build_object(
    'minimum_finals_slots',
    case
      when target_tournament.finals_starts_on is not null
        and target_tournament.finals_ends_on is not null
      then target_tournament.minimum_finals_availability_slots
      else 0
    end
  );
end;
$$;

revoke all on function public.admin_get_tournament_with_finals_minimum(uuid)
from public, anon, authenticated;
revoke all on function public.admin_create_tournament_with_finals_minimum(jsonb)
from public, anon, authenticated;
revoke all on function public.admin_update_tournament_with_finals_minimum(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_get_tournament_dated_availability_with_finals_minimum(uuid)
from public, anon, authenticated;
revoke all on function public.get_public_tournament_availability_grid_with_finals_minimum(uuid)
from public, anon, authenticated;

 grant execute on function public.admin_get_tournament_with_finals_minimum(uuid)
to authenticated;
grant execute on function public.admin_create_tournament_with_finals_minimum(jsonb)
to authenticated;
grant execute on function public.admin_update_tournament_with_finals_minimum(uuid, jsonb)
to authenticated;
grant execute on function public.admin_get_tournament_dated_availability_with_finals_minimum(uuid)
to authenticated;
grant execute on function public.get_public_tournament_availability_grid_with_finals_minimum(uuid)
to anon, authenticated;

commit;
