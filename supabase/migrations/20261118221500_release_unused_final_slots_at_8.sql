-- Release only unassigned final-stage holds at 08:00 on their local play date.
-- Actual published occupations and planned fixtures remain protected.
begin;

create or replace function public.is_tournament_finals_reserved_slot(
  target_resource_id uuid,
  target_starts_at timestamptz,
  target_ends_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    exists (
      select 1
      from public.reservable_resources resource
      join public.tournaments tournament on tournament.club_id = resource.club_id
      cross join lateral public.tournament_generated_slots(tournament.id) generated
      where resource.id = target_resource_id
        and resource.is_active
        and tournament.status not in ('cancelled', 'completed', 'archived')
        and tournament.finals_starts_on is not null
        and tournament.finals_ends_on is not null
        and generated.phase = 'finals'
        and generated.play_date between tournament.finals_starts_on and tournament.finals_ends_on
        and tstzrange(
          (generated.play_date + generated.starts_at) at time zone
            coalesce(tournament.timezone, resource.timezone, 'Europe/Paris'),
          (generated.play_date + generated.ends_at) at time zone
            coalesce(tournament.timezone, resource.timezone, 'Europe/Paris'),
          '[)'
        ) && tstzrange(target_starts_at, target_ends_at, '[)')
        and now() < (
          (generated.play_date + time '08:00') at time zone
            coalesce(tournament.timezone, resource.timezone, 'Europe/Paris')
        )
    )
    or exists (
      select 1
      from public.reservable_resources resource
      join public.tournaments tournament on tournament.club_id = resource.club_id
      join public.tournament_final_planning_nodes node
        on node.tournament_id = tournament.id
          and node.resource_id = resource.id
          and node.round = 'final'
          and node.source = 'manual'
      where resource.id = target_resource_id
        and resource.is_active
        and tournament.status not in ('cancelled', 'completed', 'archived')
        and node.play_date = tournament.finals_ends_on
        and node.starts_at is not null
        and node.ends_at is not null
        and tstzrange(
          (node.play_date + node.starts_at) at time zone resource.timezone,
          (node.play_date + node.ends_at) at time zone resource.timezone,
          '[)'
        ) && tstzrange(target_starts_at, target_ends_at, '[)')
        and now() < ((node.play_date + time '08:00') at time zone resource.timezone)
    )
    or exists (
      -- A fixture with both opponents assigned to a real court and time
      -- remains protected even if its public event has not been created yet.
      select 1
      from public.tournament_match_planning planned
      join public.tournament_matches match on match.id = planned.match_id
        and match.tournament_id = planned.tournament_id
        and match.phase = 'finals'
        and match.team_a_id is not null
        and match.team_b_id is not null
        and match.status not in ('cancelled', 'canceled')
      join public.tournaments tournament on tournament.id = match.tournament_id
      join public.reservable_resources resource on resource.id = planned.resource_id
        and resource.club_id = tournament.club_id
      where planned.resource_id = target_resource_id
        and tournament.status not in ('cancelled', 'completed', 'archived')
        and tstzrange(
          (planned.play_date + planned.starts_at) at time zone resource.timezone,
          (planned.play_date + planned.ends_at) at time zone resource.timezone,
          '[)'
        ) && tstzrange(target_starts_at, target_ends_at, '[)')
    );
$function$;

revoke all on function public.is_tournament_finals_reserved_slot(
  uuid, timestamptz, timestamptz
) from public, anon, authenticated;

-- Final-day running-order cards are purely provisional before the release
-- cutoff. Once released, do not decorate open standard slots as locked.
create or replace function public.list_public_tournament_final_day_program(
  target_resource_id uuid,
  range_start date,
  range_end date
)
returns table(
  starts_at timestamptz,
  ends_at timestamptz,
  display_name text,
  display_color text,
  series_id uuid,
  published boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (node.play_date + node.starts_at) at time zone resource.timezone,
    (node.play_date + node.ends_at) at time zone resource.timezone,
    concat(
      'Finale ', series.name,
      case
        when m.team_a_id is not null and m.team_b_id is not null then
          concat(
            ' · ', public.tournament_team_public_label(m.team_a_id),
            ' — ', public.tournament_team_public_label(m.team_b_id)
          )
        else ' · Adversaires à déterminer'
      end
    ),
    series.color,
    node.series_id,
    exists (
      select 1
      from public.tournament_match_events link
      join public.events e on e.id = link.event_id
        and e.publication_status = 'published'
      where link.match_id = m.id
    )
  from public.reservable_resources resource
  join public.tournaments t on t.club_id = resource.club_id
  join public.tournament_final_planning_nodes node
    on node.tournament_id = t.id
      and node.resource_id = resource.id
      and node.round = 'final'
  join public.tournament_series series
    on series.id = node.series_id and series.tournament_id = t.id
  left join public.tournament_matches m
    on m.tournament_id = node.tournament_id
      and m.series_id = node.series_id
      and m.phase = 'finals'
      and m.final_round = 'final'
      and m.final_round_number = node.round_number
      and m.display_order = node.display_order
  where resource.id = target_resource_id
    and resource.is_active
    and t.status in ('planning_published', 'in_progress')
    and node.play_date between range_start and range_end
    and node.play_date = t.finals_ends_on
    and node.starts_at is not null and node.ends_at is not null
    and node.source = 'manual'
    and (
      now() < ((node.play_date + time '08:00') at time zone resource.timezone)
      or exists (
        select 1 from public.tournament_match_planning planned
        where planned.match_id = m.id
          and planned.resource_id = resource.id
          and planned.play_date = node.play_date
          and planned.starts_at < node.ends_at
          and planned.ends_at > node.starts_at
          and m.team_a_id is not null and m.team_b_id is not null
          and m.status not in ('cancelled', 'canceled')
      )
      or exists (
        select 1
        from public.tournament_match_events link
        join public.events e on e.id = link.event_id
          and e.publication_status = 'published'
        where link.match_id = m.id
      )
    )
  order by node.play_date, node.starts_at, series.display_order;
$function$;

revoke all on function public.list_public_tournament_final_day_program(
  uuid, date, date
) from public, anon, authenticated;
grant execute on function public.list_public_tournament_final_day_program(
  uuid, date, date
) to anon, authenticated;

commit;
