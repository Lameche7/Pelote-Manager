-- Show championship players in TV, with team labels only as fallback.
CREATE OR REPLACE FUNCTION public.get_public_tv_championship_slot_decorations(target_token uuid)
 RETURNS TABLE(resource_id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone, championship_name text, division_name text, match_label text, display_color text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select distinct
    reservation.resource_id,
    reservation.starts_at,
    reservation.ends_at,
    championship.name,
    division.name,
    concat_ws(E'\\n',
      coalesce((
        select string_agg(concat_ws(' ',nullif(p.first_name,''),nullif(p.last_name,'')), ' / ' order by p.last_name,p.first_name)
        from public.championship_team_players tp
        join public.championship_players p on p.id=tp.player_id
        where tp.team_id=match.team1_id
      ), team1.source_label),
      concat('vs ',coalesce((
        select string_agg(concat_ws(' ',nullif(p.first_name,''),nullif(p.last_name,'')), ' / ' order by p.last_name,p.first_name)
        from public.championship_team_players tp
        join public.championship_players p on p.id=tp.player_id
        where tp.team_id=match.team2_id
      ),team2.source_label))
    ),
    coalesce(division.display_color, '#D5B04C')
  from public.club_tv_settings as settings
  join public.club_tv_resources as selected_resource
    on selected_resource.club_id = settings.club_id
  join public.reservations as reservation
    on reservation.resource_id = selected_resource.resource_id
   and reservation.status in ('pending', 'confirmed')
   and reservation.championship_match_id is not null
  join public.championship_matches as match
    on match.id = reservation.championship_match_id
  join public.championship_divisions as division
    on division.id = match.division_id
  join public.championships as championship
    on championship.id = division.championship_id
  join public.championship_teams as team1 on team1.id = match.team1_id
  join public.championship_teams as team2 on team2.id = match.team2_id
  where settings.public_token = target_token
    and settings.is_enabled
    and reservation.ends_at > (
      ((now() at time zone 'Europe/Paris')::date)::timestamp
      at time zone 'Europe/Paris'
    )
    and reservation.starts_at < (
      (((now() at time zone 'Europe/Paris')::date + 7)::timestamp)
      at time zone 'Europe/Paris'
    )
  order by reservation.starts_at, reservation.resource_id;
$function$

