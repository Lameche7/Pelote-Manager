-- Reserve configured tournament finals windows even before matches are published.
create or replace function public.is_tournament_finals_reserved_slot(target_resource_id uuid, target_starts_at timestamptz, target_ends_at timestamptz)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.reservable_resources as resource
    join public.tournaments as tournament on tournament.club_id = resource.club_id
    cross join lateral public.tournament_generated_slots(tournament.id) as generated
    where resource.id = target_resource_id
      and resource.is_active
      and tournament.status not in ('cancelled', 'completed', 'archived')
      and tournament.finals_starts_on is not null
      and tournament.finals_ends_on is not null
      and generated.phase = 'finals'
      and generated.play_date between tournament.finals_starts_on and tournament.finals_ends_on
      and tstzrange(
        generated.play_date + generated.starts_at at time zone coalesce(tournament.timezone, resource.timezone, 'Europe/Paris'),
        generated.play_date + generated.ends_at at time zone coalesce(tournament.timezone, resource.timezone, 'Europe/Paris'), '[)'
      ) && tstzrange(target_starts_at, target_ends_at, '[)')
  );
$$;
revoke all on function public.is_tournament_finals_reserved_slot(uuid,timestamptz,timestamptz) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.list_available_slots_v3(target_resource_id uuid, range_start date, range_end date)
 RETURNS TABLE(resource_id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, status text, booking_opens_at timestamp with time zone, booked_by_name text, occupation_type text, display_color text, reservation_access text, result_display text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    slot.resource_id,
    slot.starts_at,
    slot.ends_at,
    case
      when finals.is_reserved and slot.status in ('available', 'locked') then 'locked'
      when slot.occupation_type = 'reservation'
        and slot.booking_opens_at is not null
        and now() < slot.booking_opens_at
      then 'locked'
      else slot.status
    end,
    case when finals.is_reserved then null else slot.booking_opens_at end,
    case
      when slot.occupation_type = 'reservation'
        and slot.booking_opens_at is not null
        and now() < slot.booking_opens_at
      then null
      when finals.is_reserved and slot.status in ('available', 'locked') then 'Réservé – Phases finales du tournoi'
      else coalesce(championship_slot.display_name, slot.booked_by_name)
    end,
    case
      when slot.occupation_type = 'reservation'
        and slot.booking_opens_at is not null
        and now() < slot.booking_opens_at
      then null
      when championship_slot.match_id is not null then 'championship_match'
      when finals.is_reserved and slot.status in ('available', 'locked') then 'tournament_finals_hold'
      else slot.occupation_type
    end,
    case
      when slot.occupation_type = 'reservation'
        and slot.booking_opens_at is not null
        and now() < slot.booking_opens_at
      then null
      else coalesce(championship_slot.display_color, slot.display_color)
    end,
    slot.reservation_access,
    case
      when slot.occupation_type = 'reservation'
        and slot.booking_opens_at is not null
        and now() < slot.booking_opens_at
      then null
      else coalesce(championship_slot.result_display, tournament_slot.result_display)
    end
  from public.list_available_slots_v2(target_resource_id, range_start, range_end) as slot
  cross join lateral (select public.is_tournament_finals_reserved_slot(slot.resource_id,slot.starts_at,slot.ends_at) as is_reserved) as finals
  left join lateral (
    select
      match.id as match_id,
      concat_ws(E'
',
        championship.name,
        division.name,
        coalesce(nullif((
          select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.last_name, player.first_name, player.licence_number)
          from public.championship_team_players as team_player
          join public.championship_players as player on player.id = team_player.player_id
          where team_player.team_id = team1.id
        ), ''), team1.source_label),
        concat('vs ', coalesce(nullif((
          select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.last_name, player.first_name, player.licence_number)
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
              select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.last_name, player.first_name, player.licence_number)
              from public.championship_team_players as team_player
              join public.championship_players as player on player.id = team_player.player_id
              where team_player.team_id = team1.id
            ), ''), team1.source_label),
            '  ', match.score_team1, ' – ', match.score_team2, '  ',
            coalesce(nullif((
              select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.last_name, player.first_name, player.licence_number)
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
      and reservation.starts_at < slot.ends_at and reservation.ends_at > slot.starts_at
    order by reservation.created_at desc limit 1
  ) as championship_slot on true
  left join lateral (
    select
      case when result.status = 'validated' then
        concat(
          coalesce(nullif((
            select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.display_order, player.id)
            from public.tournament_team_players as player where player.team_id = match.team_a_id
          ), ''), 'Équipe 1'),
          '  ',
          coalesce(
            case
              when result.team_a_points is not null and result.team_b_points is not null
                then concat(result.team_a_points, ' – ', result.team_b_points)
              when result.team_a_sets is not null and result.team_b_sets is not null
                then concat(result.team_a_sets, ' – ', result.team_b_sets)
            end,
            ''
          ),
          '  ',
          coalesce(nullif((
            select string_agg(concat_ws(' ', upper(player.last_name), player.first_name), ' / ' order by player.display_order, player.id)
            from public.tournament_team_players as player where player.team_id = match.team_b_id
          ), ''), 'Équipe 2')
        )
      end as result_display
    from public.calendar_occupations as occupation
    join public.event_resources as event_resource on event_resource.calendar_occupation_id = occupation.id
    join public.tournament_match_events as match_event on match_event.event_id = event_resource.event_id
    join public.tournament_matches as match on match.id = match_event.match_id
    left join public.tournament_match_results as result on result.match_id = match.id
    where occupation.resource_id = slot.resource_id
      and occupation.cancelled_at is null
      and occupation.starts_at = slot.starts_at
      and occupation.ends_at = slot.ends_at
    limit 1
  ) as tournament_slot on true
  order by slot.starts_at;
$function$

create or replace function public.assert_not_tournament_finals_slot(target_resource_id uuid,target_starts_at timestamptz)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare slot_end timestamptz;
begin
  select slot.ends_at into slot_end
  from public.list_available_slots_v2(
    target_resource_id,
    (target_starts_at at time zone 'Europe/Paris')::date,
    (target_starts_at at time zone 'Europe/Paris')::date
  ) as slot where slot.starts_at = target_starts_at limit 1;
  if slot_end is not null and public.is_tournament_finals_reserved_slot(target_resource_id,target_starts_at,slot_end) then
    raise exception 'Créneau réservé aux phases finales du tournoi' using errcode='P0001';
  end if;
end;
$$;
revoke all on function public.assert_not_tournament_finals_slot(uuid,timestamptz) from public,anon,authenticated;

do $$
declare sig text; original text; patched text;
begin
  foreach sig in array array[
    'public.create_reservation(uuid,timestamptz,text,text,text)',
    'public.reserve_for_payment(uuid,timestamptz,text,text,text)',
    'public.reserve_for_split_payment(uuid,timestamptz,uuid[])'
  ] loop
    original := pg_get_functiondef(sig::regprocedure);
    patched := regexp_replace(original, E'\\nbegin\\n', E'\\nbegin\\n  perform public.assert_not_tournament_finals_slot(target_resource_id,target_starts_at);\\n', 1, 1);
    if patched=original then raise exception 'Cannot patch %',sig; end if;
    execute patched;
  end loop;
end $$;
