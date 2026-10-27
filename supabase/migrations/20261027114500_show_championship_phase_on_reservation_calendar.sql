-- Label the current championship phase on reservation calendar cards.
CREATE OR REPLACE FUNCTION public.list_available_slots_v4(target_resource_id uuid, range_start date, range_end date)
 RETURNS TABLE(resource_id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, booking_opens_at timestamp with time zone, booked_by_name text, occupation_type text, display_color text, reservation_access text, result_display text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select
  slot.resource_id,
  slot.starts_at,
  slot.ends_at,
  case when championship_slot.match_id is not null then 'occupied' else slot.status end,
  slot.booking_opens_at,
  coalesce(championship_slot.display_name, slot.booked_by_name),
  case when championship_slot.match_id is not null then 'championship_match' else slot.occupation_type end,
  coalesce(championship_slot.display_color, slot.display_color),
  slot.reservation_access,
  coalesce(championship_slot.result_display, slot.result_display)
from public.list_available_slots_v3(target_resource_id, range_start, range_end) as slot
left join lateral (
  select
    match.id as match_id,
    concat_ws(E'\n',
      championship.name,
      concat(division.name, ' · ', case when match.phase = 'Poules' then 'Poules' else match.phase end),
      coalesce(nullif((
        select string_agg(
          concat_ws(' ', upper(player.last_name), player.first_name),
          ' / '
          order by player.last_name, player.first_name, player.licence_number
        )
        from public.championship_team_players as team_player
        join public.championship_players as player on player.id = team_player.player_id
        where team_player.team_id = team1.id
      ), ''), team1.source_label),
      concat('vs ', coalesce(nullif((
        select string_agg(
          concat_ws(' ', upper(player.last_name), player.first_name),
          ' / '
          order by player.last_name, player.first_name, player.licence_number
        )
        from public.championship_team_players as team_player
        join public.championship_players as player on player.id = team_player.player_id
        where team_player.team_id = team2.id
      ), ''), team2.source_label))
    ) as display_name,
    coalesce(division.display_color, '#D5B04C') as display_color,
    case
      when match.status = 'played' and match.score_team1 is not null and match.score_team2 is not null then
        concat(
          coalesce(nullif((
            select string_agg(
              concat_ws(' ', upper(player.last_name), player.first_name),
              ' / '
              order by player.last_name, player.first_name, player.licence_number
            )
            from public.championship_team_players as team_player
            join public.championship_players as player on player.id = team_player.player_id
            where team_player.team_id = team1.id
          ), ''), team1.source_label),
          '  ', match.score_team1, ' – ', match.score_team2, '  ',
          coalesce(nullif((
            select string_agg(
              concat_ws(' ', upper(player.last_name), player.first_name),
              ' / '
              order by player.last_name, player.first_name, player.licence_number
            )
            from public.championship_team_players as team_player
            join public.championship_players as player on player.id = team_player.player_id
            where team_player.team_id = team2.id
          ), ''), team2.source_label)
        )
      else null
    end as result_display
  from public.reservations as reservation
  join public.championship_matches as match on match.id = reservation.championship_match_id
  join public.championship_divisions as division on division.id = match.division_id
  join public.championships as championship on championship.id = division.championship_id
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
$function$


-- Scoped lookup for the results administrator. Keep the existing day-results
-- RPC return type unchanged and avoid exposing championship_matches directly.
create or replace function public.admin_list_championship_match_phases(target_id uuid)
returns table(match_id uuid, phase text)
language plpgsql stable security definer set search_path = '' as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if auth.uid() is null
    or target_club_id is null
    or not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query
  select m.id, m.phase
  from public.championship_matches as m
  join public.championship_divisions as d on d.id = m.division_id
  join public.championship_teams as t1 on t1.id = m.team1_id
  join public.championship_teams as t2 on t2.id = m.team2_id
  join public.championship_federation_clubs as c1 on c1.id = t1.federation_club_id
  join public.championship_federation_clubs as c2 on c2.id = t2.federation_club_id
  where d.championship_id = target_id
    and (c1.linked_club_id = target_club_id or c2.linked_club_id = target_club_id);
end $$;
revoke all on function public.admin_list_championship_match_phases(uuid) from public, anon;
grant execute on function public.admin_list_championship_match_phases(uuid) to authenticated;
