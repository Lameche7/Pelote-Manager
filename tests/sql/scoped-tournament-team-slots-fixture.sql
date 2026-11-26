-- Ephemeral CI only: empty relations for the imported, planned and special slot sources.
-- The native date/window generator below is the historical production implementation.
create table public.tournament_import_availability_slots (
 tournament_id uuid not null references public.tournaments(id),
 play_date date not null, starts_at time not null, ends_at time not null, phase text not null
);
create table public.tournament_matches (
 id uuid primary key default gen_random_uuid(),
 tournament_id uuid not null references public.tournaments(id), phase text not null
);
create table public.tournament_match_planning (
 match_id uuid not null references public.tournament_matches(id),
 play_date date not null, starts_at time not null, ends_at time not null
);
create table public.tournament_final_event_slots (
 tournament_id uuid not null references public.tournaments(id),
 play_date date not null, starts_at time not null, ends_at time not null
);
CREATE OR REPLACE FUNCTION public.tournament_generated_slots(target_tournament_id uuid)
 RETURNS TABLE(play_date date, starts_at time without time zone, ends_at time without time zone, phase text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  union

  select special.play_date, special.starts_at, special.ends_at, 'finals'::text
  from public.tournament_final_event_slots as special
  where special.tournament_id = target_tournament_id

  order by play_date, starts_at, ends_at, phase;
$function$;
