begin;

-- PR68 — L'administration doit lire les mêmes disponibilités datées que
-- l'inscription publique et les futurs moteurs de poules/planning.

create or replace function public.admin_get_tournament_dated_availability(
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
  slot_interval interval;
  available_slot_count integer := 0;
  available_weekend_slot_count integer := 0;
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

  slot_interval := make_interval(mins => target_tournament.slot_duration_minutes);

  with generated_slots as (
    select distinct
      date_series.play_timestamp::date as play_date,
      slot_series.starts_at::time as starts_at,
      (slot_series.starts_at + slot_interval)::time as ends_at
    from generate_series(
      target_tournament.starts_on::timestamp,
      target_tournament.ends_on::timestamp,
      interval '1 day'
    ) as date_series(play_timestamp)
    join public.tournament_play_windows as play_window
      on play_window.tournament_id = target_tournament.id
     and play_window.weekday = extract(dow from date_series.play_timestamp)::integer
    cross join lateral generate_series(
      date_series.play_timestamp::date + play_window.opens_at,
      date_series.play_timestamp::date + play_window.closes_at - slot_interval,
      slot_interval
    ) as slot_series(starts_at)
  )
  select
    count(*)::integer,
    count(*) filter (
      where extract(dow from generated_slots.play_date)::integer in (0, 6)
    )::integer
  into available_slot_count, available_weekend_slot_count
  from generated_slots;

  return jsonb_build_object(
    'minimum_total', target_tournament.minimum_availability_slots,
    'minimum_weekend', target_tournament.minimum_weekend_availability_slots,
    'available_slot_count', available_slot_count,
    'available_weekend_slot_count', available_weekend_slot_count,
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'team_id', stats.team_id,
            'slot_count', stats.slot_count,
            'weekend_slot_count', stats.weekend_slot_count
          )
          order by stats.team_id
        ),
        '[]'::jsonb
      )
      from (
        select
          team.id as team_id,
          count(availability.id)::integer as slot_count,
          count(availability.id) filter (
            where extract(dow from availability.play_date)::integer in (0, 6)
          )::integer as weekend_slot_count
        from public.tournament_teams as team
        left join public.tournament_team_availability_slots as availability
          on availability.team_id = team.id
         and availability.tournament_id = target_tournament.id
        where team.tournament_id = target_tournament.id
        group by team.id
      ) as stats
    )
  );
end;
$$;

revoke all on function public.admin_get_tournament_dated_availability(uuid)
from public, anon, authenticated;
grant execute on function public.admin_get_tournament_dated_availability(uuid)
to authenticated;

commit;
