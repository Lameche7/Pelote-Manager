begin;

-- PR69 complément — la phase finale exige au moins 35 créneaux disponibles
-- par équipe dès lors qu'une phase finale est configurée.

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

  return selected_finals_count >= 35;
end;
$$;

create or replace function public.assert_tournament_team_finals_availability(
  target_team_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.tournament_team_finals_availability_is_valid(target_team_id) then
    raise exception 'Tournament finals availability minimum not reached'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.enforce_tournament_team_finals_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_tournament_team_finals_availability(
    coalesce(new.team_id, old.team_id)
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.enforce_tournament_team_status_finals_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_tournament_team_finals_availability(
    coalesce(new.id, old.id)
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.enforce_tournament_finals_availability_for_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament_id uuid;
  team_row record;
begin
  if tg_table_name = 'tournaments' then
    target_tournament_id := coalesce(new.id, old.id);
  else
    target_tournament_id := coalesce(new.tournament_id, old.tournament_id);
  end if;

  for team_row in
    select team.id
    from public.tournament_teams as team
    where team.tournament_id = target_tournament_id
      and team.status in ('pending', 'accepted')
  loop
    perform public.assert_tournament_team_finals_availability(team_row.id);
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists tournament_team_availability_finals_minimum_guard
on public.tournament_team_availability_slots;

create constraint trigger tournament_team_availability_finals_minimum_guard
after insert or update or delete
on public.tournament_team_availability_slots
deferrable initially deferred
for each row
execute function public.enforce_tournament_team_finals_availability();

drop trigger if exists tournament_team_status_finals_minimum_guard
on public.tournament_teams;

create constraint trigger tournament_team_status_finals_minimum_guard
after insert or update
on public.tournament_teams
deferrable initially deferred
for each row
execute function public.enforce_tournament_team_status_finals_availability();

drop trigger if exists tournament_finals_minimum_guard
on public.tournaments;

create constraint trigger tournament_finals_minimum_guard
after update
on public.tournaments
deferrable initially deferred
for each row
execute function public.enforce_tournament_finals_availability_for_teams();

drop trigger if exists tournament_play_windows_finals_minimum_guard
on public.tournament_play_windows;

create constraint trigger tournament_play_windows_finals_minimum_guard
after insert or update or delete
on public.tournament_play_windows
deferrable initially deferred
for each row
execute function public.enforce_tournament_finals_availability_for_teams();

-- Le générateur PR69 est conservé comme implémentation de base puis enveloppé
-- pour garantir au moins 35 créneaux de phase finale à chaque équipe fictive.
do $$
begin
  if to_regprocedure(
    'public.generate_tournament_test_data_phase_aware_legacy(uuid,integer)'
  ) is null then
    alter function public.generate_tournament_test_data(uuid, integer)
    rename to generate_tournament_test_data_phase_aware_legacy;
  end if;
end
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

    if available_finals_count < 35 then
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

      missing_finals_count := greatest(35 - selected_finals_count, 0);

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
        and target_tournament.finals_ends_on is not null then 35
      else 0
    end
  );
end;
$$;

revoke all on function public.tournament_team_finals_availability_is_valid(uuid)
from public, anon, authenticated;
revoke all on function public.assert_tournament_team_finals_availability(uuid)
from public, anon, authenticated;
revoke all on function public.enforce_tournament_team_finals_availability()
from public, anon, authenticated;
revoke all on function public.enforce_tournament_team_status_finals_availability()
from public, anon, authenticated;
revoke all on function public.enforce_tournament_finals_availability_for_teams()
from public, anon, authenticated;
revoke all on function public.generate_tournament_test_data(uuid, integer)
from public, anon, authenticated;
revoke all on function public.generate_tournament_test_data_phase_aware_legacy(uuid, integer)
from public, anon, authenticated;

commit;
