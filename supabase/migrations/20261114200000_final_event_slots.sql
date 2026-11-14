-- Standalone final-day event slots: only club admins can add explicitly chosen times.
create table public.tournament_final_event_slots (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  play_date date not null,
  starts_at time without time zone not null,
  ends_at time without time zone not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (tournament_id, play_date, starts_at),
  constraint final_event_slot_positive_duration check (ends_at > starts_at)
);

alter table public.tournament_final_event_slots enable row level security;
revoke all on table public.tournament_final_event_slots from public, anon, authenticated;

-- Extend the existing generated slot source without modifying the imported availability.
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
$function$


create or replace function public.admin_add_tournament_final_event_slot(
  target_tournament_id uuid,
  target_starts_at time without time zone,
  target_ends_at time without time zone
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target_club_id uuid := public.admin_current_club_id();
  official_date date;
begin
  if auth.uid() is null or not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;

  select t.finals_ends_on into official_date
  from public.tournaments t
  where t.id=target_tournament_id and t.club_id=target_club_id;

  if official_date is null then
    raise exception 'Tournament not found or final date is not configured' using errcode='22023';
  end if;

  if target_starts_at is null or target_ends_at is null
     or target_ends_at <= target_starts_at
     or target_ends_at - target_starts_at > interval '5 hours'
     or target_ends_at - target_starts_at < interval '30 minutes' then
    raise exception 'Invalid final slot duration' using errcode='22023';
  end if;

  if exists (
    select 1 from public.tournament_final_event_slots slot
    where slot.tournament_id=target_tournament_id
      and slot.play_date=official_date
      and slot.starts_at < target_ends_at
      and slot.ends_at > target_starts_at
  ) then
    raise exception 'Final slot overlaps an existing final slot' using errcode='23505';
  end if;

  insert into public.tournament_final_event_slots
    (tournament_id,play_date,starts_at,ends_at)
  values (target_tournament_id,official_date,target_starts_at,target_ends_at);

  return 1;
end;
$function$;

revoke all on function public.admin_add_tournament_final_event_slot(uuid,time without time zone,time without time zone)
  from public,anon;
grant execute on function public.admin_add_tournament_final_event_slot(uuid,time without time zone,time without time zone)
  to authenticated;
