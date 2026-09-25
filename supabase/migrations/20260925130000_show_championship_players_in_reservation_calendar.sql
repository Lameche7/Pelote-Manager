begin;

create or replace function public.list_available_slots_v3(
  target_resource_id uuid,
  range_start date,
  range_end date
)
returns table (
  resource_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  booking_opens_at timestamptz,
  booked_by_name text,
  occupation_type text,
  display_color text,
  reservation_access text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    slot.resource_id,
    slot.starts_at,
    slot.ends_at,
    slot.status,
    slot.booking_opens_at,
    coalesce(championship_slot.display_name, slot.booked_by_name),
    case
      when championship_slot.match_id is not null then 'championship_match'
      else slot.occupation_type
    end,
    coalesce(championship_slot.display_color, slot.display_color),
    slot.reservation_access
  from public.list_available_slots_v2(
    target_resource_id,
    range_start,
    range_end
  ) as slot
  left join lateral (
    select
      match.id as match_id,
      concat_ws(E'\n',
        championship.name,
        division.name,
        concat_ws(' · ',
          team1.source_label,
          nullif((
            select string_agg(
              concat_ws(' ', upper(player.last_name), player.first_name),
              ' / '
              order by player.last_name, player.first_name, player.licence_number
            )
            from public.championship_team_players as team_player
            join public.championship_players as player
              on player.id = team_player.player_id
            where team_player.team_id = team1.id
          ), '')
        ),
        concat('vs ', concat_ws(' · ',
          team2.source_label,
          nullif((
            select string_agg(
              concat_ws(' ', upper(player.last_name), player.first_name),
              ' / '
              order by player.last_name, player.first_name, player.licence_number
            )
            from public.championship_team_players as team_player
            join public.championship_players as player
              on player.id = team_player.player_id
            where team_player.team_id = team2.id
          ), '')
        ))
      ) as display_name,
      coalesce(division.display_color, '#D5B04C') as display_color
    from public.reservations as reservation
    join public.championship_matches as match
      on match.id = reservation.championship_match_id
    join public.championship_divisions as division
      on division.id = match.division_id
    join public.championships as championship
      on championship.id = division.championship_id
    join public.championship_teams as team1 on team1.id = match.team1_id
    join public.championship_teams as team2 on team2.id = match.team2_id
    where reservation.resource_id = slot.resource_id
      and reservation.status in ('pending', 'confirmed')
      and reservation.starts_at < slot.ends_at
      and reservation.ends_at > slot.starts_at
    order by reservation.created_at desc
    limit 1
  ) as championship_slot on true
  order by slot.starts_at;
$$;

revoke all on function public.list_available_slots_v3(uuid, date, date)
from public, anon, authenticated;
grant execute on function public.list_available_slots_v3(uuid, date, date)
to anon, authenticated;

commit;
