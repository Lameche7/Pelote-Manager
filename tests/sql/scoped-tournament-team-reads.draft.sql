-- Explicit club-scoped team reads; legacy RPCs unchanged.
CREATE OR REPLACE FUNCTION public.admin_list_tournament_teams_for_club(target_club_id uuid, target_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not exists (select 1 from public.tournaments t where t.id = target_tournament_id and t.club_id = target_club_id) then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;
  perform public.sync_tournament_registration_states(target_club_id);

  select jsonb_build_object(
    'tournament', jsonb_build_object(
      'id', tournament.id,
      'name', tournament.name,
      'status', tournament.status,
      'registration_opens_at', tournament.registration_opens_at,
      'registration_closes_at', tournament.registration_closes_at
    ),
    'series', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', series.id,
            'name', series.name,
            'capacity', series.capacity,
            'enabled', series.enabled,
            'reserved_count', public.tournament_series_reserved_count(series.id, null),
            'accepted_count', (
              select count(*)
              from public.tournament_teams as accepted_team
              where accepted_team.series_id = series.id
                and accepted_team.status = 'accepted'
            )
          )
          order by series.display_order, series.name
        ),
        '[]'::jsonb
      )
      from public.tournament_series as series
      where series.tournament_id = tournament.id
    ),
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', team.id,
            'series_id', team.series_id,
            'series_name', series.name,
            'status', team.status,
            'contact_email', team.contact_email,
            'contact_phone', team.contact_phone,
            'comments', team.comments,
            'submitted_by', team.submitted_by,
            'registered_at', team.registered_at,
            'updated_at', team.updated_at,
            'players', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'member_id', player.member_id,
                    'first_name', player.first_name,
                    'last_name', player.last_name,
                    'email', player.email,
                    'phone', player.phone,
                    'role', player.role
                  )
                  order by player.display_order
                ),
                '[]'::jsonb
              )
              from public.tournament_team_players as player
              where player.team_id = team.id
            ),
            'availability_rules', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'kind', rule.kind,
                    'weekday', rule.weekday,
                    'starts_at', rule.starts_at,
                    'ends_at', rule.ends_at
                  )
                  order by rule.display_order, rule.weekday, rule.starts_at
                ),
                '[]'::jsonb
              )
              from public.tournament_team_availability_rules as rule
              where rule.team_id = team.id
            )
          )
          order by series.display_order, team.registered_at, team.id
        ),
        '[]'::jsonb
      )
      from public.tournament_teams as team
      join public.tournament_series as series on series.id = team.series_id
      where team.tournament_id = tournament.id
    )
  )
  into result
  from public.tournaments as tournament
  where tournament.id = target_tournament_id
    and tournament.club_id = target_club_id;

  if result is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  return result;
end;
$function$;
revoke all on function public.admin_list_tournament_teams_for_club(uuid, uuid) from public, anon;
grant execute on function public.admin_list_tournament_teams_for_club(uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_tournament_teams_v2_for_club(target_club_id uuid, target_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  base_payload jsonb;
begin
  base_payload := public.admin_list_tournament_teams_for_club(target_club_id, target_tournament_id);

  return base_payload || jsonb_build_object(
    'teams', (
      select coalesce(
        jsonb_agg(
          team_item.value || jsonb_build_object(
            'players', public.tournament_players_with_clubs(
              (team_item.value->>'id')::uuid,
              team_item.value->'players'
            )
          )
          order by team_item.ordinality
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(coalesce(base_payload->'teams', '[]'::jsonb))
        with ordinality as team_item(value, ordinality)
    )
  );
end;
$function$;
revoke all on function public.admin_list_tournament_teams_v2_for_club(uuid, uuid) from public, anon;
grant execute on function public.admin_list_tournament_teams_v2_for_club(uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_tournament_teams_v3_for_club(target_club_id uuid, target_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  base_payload jsonb;
begin
  base_payload := public.admin_list_tournament_teams_v2_for_club(target_club_id, target_tournament_id);

  return base_payload || jsonb_build_object(
    'teams', (
      select coalesce(
        jsonb_agg(
          team_item.value || jsonb_build_object(
            'players', public.tournament_admin_players_with_member_flags(
              (team_item.value->>'id')::uuid,
              team_item.value->'players'
            )
          )
          order by team_item.ordinality
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(coalesce(base_payload->'teams', '[]'::jsonb))
        with ordinality as team_item(value, ordinality)
    )
  );
end;
$function$;
revoke all on function public.admin_list_tournament_teams_v3_for_club(uuid, uuid) from public, anon;
grant execute on function public.admin_list_tournament_teams_v3_for_club(uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_tournament_dated_availability_for_club(target_club_id uuid, target_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_tournament public.tournaments;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
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

  return jsonb_build_object(
    'minimum_total', target_tournament.minimum_availability_slots,
    'minimum_weekend', target_tournament.minimum_weekend_availability_slots,
    'slot_duration_minutes', target_tournament.slot_duration_minutes,
    'pool_starts_on', target_tournament.pool_starts_on,
    'pool_ends_on', target_tournament.pool_ends_on,
    'finals_starts_on', target_tournament.finals_starts_on,
    'finals_ends_on', target_tournament.finals_ends_on,
    'available_slot_count', (
      select count(*) from public.tournament_generated_slots(target_tournament.id)
    ),
    'available_weekend_slot_count', (
      select count(*)
      from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'pools'
        and extract(dow from generated.play_date)::integer in (0, 6)
    ),
    'available_pool_slot_count', (
      select count(*)
      from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'pools'
    ),
    'available_finals_slot_count', (
      select count(*)
      from public.tournament_generated_slots(target_tournament.id) as generated
      where generated.phase = 'finals'
    ),
    'slots', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'play_date', generated.play_date,
            'starts_at', generated.starts_at,
            'ends_at', generated.ends_at,
            'phase', generated.phase
          )
          order by
            case generated.phase when 'pools' then 0 else 1 end,
            generated.play_date,
            generated.starts_at
        ),
        '[]'::jsonb
      )
      from public.tournament_generated_slots(target_tournament.id) as generated
    ),
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'team_id', stats.team_id,
            'slot_count', stats.slot_count,
            'weekend_slot_count', stats.pool_weekend_slot_count,
            'pool_slot_count', stats.pool_slot_count,
            'finals_slot_count', stats.finals_slot_count
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
            where generated.phase = 'pools'
          )::integer as pool_slot_count,
          count(availability.id) filter (
            where generated.phase = 'finals'
          )::integer as finals_slot_count,
          count(availability.id) filter (
            where generated.phase = 'pools'
              and extract(dow from availability.play_date)::integer in (0, 6)
          )::integer as pool_weekend_slot_count
        from public.tournament_teams as team
        left join public.tournament_team_availability_slots as availability
          on availability.team_id = team.id
         and availability.tournament_id = target_tournament.id
        left join public.tournament_generated_slots(target_tournament.id) as generated
          on generated.play_date = availability.play_date
         and generated.starts_at = availability.starts_at
         and generated.ends_at = availability.ends_at
        where team.tournament_id = target_tournament.id
        group by team.id
      ) as stats
    )
  );
end;
$function$;
revoke all on function public.admin_get_tournament_dated_availability_for_club(uuid, uuid) from public, anon;
grant execute on function public.admin_get_tournament_dated_availability_for_club(uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_tournament_dated_availability_with_finals_minimum_for_club(target_club_id uuid, target_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  base_payload jsonb;
  target_minimum integer;
begin
  base_payload := public.admin_get_tournament_dated_availability_for_club(target_club_id, target_tournament_id);

  select tournament.minimum_finals_availability_slots
  into target_minimum
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  return base_payload || jsonb_build_object(
    'minimum_finals',
    coalesce(target_minimum, 35)
  );
end;
$function$;
revoke all on function public.admin_get_tournament_dated_availability_with_finals_minimum_for_club(uuid, uuid) from public, anon;
grant execute on function public.admin_get_tournament_dated_availability_with_finals_minimum_for_club(uuid, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_tournament_team_dated_availability_for_club(target_club_id uuid, target_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_team public.tournament_teams;
begin
  if auth.uid() is null or target_club_id is null or not coalesce((public.can_administer_club(target_club_id, 'tournaments.manage') or pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id)), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select team.*
  into target_team
  from public.tournament_teams as team
  join public.tournaments as tournament on tournament.id = team.tournament_id
  where team.id = target_team_id
    and tournament.club_id = target_club_id;

  if target_team.id is null then
    raise exception 'Tournament team not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'team_id', target_team.id,
    'tournament_id', target_team.tournament_id,
    'slots', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'play_date', availability.play_date,
            'starts_at', availability.starts_at,
            'ends_at', availability.ends_at,
            'phase', generated.phase
          )
          order by availability.play_date, availability.starts_at, availability.ends_at
        ),
        '[]'::jsonb
      )
      from public.tournament_team_availability_slots as availability
      left join public.tournament_generated_slots(target_team.tournament_id) as generated
        on generated.play_date = availability.play_date
       and generated.starts_at = availability.starts_at
       and generated.ends_at = availability.ends_at
      where availability.team_id = target_team.id
        and availability.tournament_id = target_team.tournament_id
    )
  );
end;
$function$;
revoke all on function public.admin_get_tournament_team_dated_availability_for_club(uuid, uuid) from public, anon;
grant execute on function public.admin_get_tournament_team_dated_availability_for_club(uuid, uuid) to authenticated;

