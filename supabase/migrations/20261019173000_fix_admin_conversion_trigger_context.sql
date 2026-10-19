-- Narrow trigger exemption for admin conversion of an already occupied slot.
CREATE OR REPLACE FUNCTION public.validate_championship_match_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_club_id uuid;
  target_championship_status public.championship_status;
  player_team_id uuid;
begin
  if new.championship_match_id is null then
    return new;
  end if;

  -- Allow an authorized admin conversion of an existing reservation only.
  if tg_op = 'UPDATE'
    and old.championship_match_id is null
    and new.championship_match_id is not null
    and old.id = new.id
    and old.user_id is not distinct from new.user_id
    and old.resource_id is not distinct from new.resource_id
    and current_setting('pilotoki.admin_championship_conversion_id', true) = new.id::text
    and auth.uid() is not null
    and public.has_club_permission(
      (select rr.club_id from public.reservable_resources rr where rr.id = new.resource_id),
      'reservations.manage'
    )
    and public.has_club_permission(
      (select rr.club_id from public.reservable_resources rr where rr.id = new.resource_id),
      'championships.manage'
    )
  then
    return new;
  end if;

  if new.user_id is null then
    raise exception 'Une réservation de championnat nécessite un compte joueur'
      using errcode = '42501';
  end if;

  select resource.club_id, championship.status,
    case
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player on player.id = team_player.player_id
        where player.profile_id = new.user_id and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player on player.id = team_player.player_id
        join public.championship_teams as away_team on away_team.id = match.team2_id
        join public.championship_federation_clubs as away_club on away_club.id = away_team.federation_club_id
        join public.championship_match_club_venue_overrides as venue_override
          on venue_override.match_id = match.id and venue_override.club_id = away_club.linked_club_id and venue_override.enabled
        where player.profile_id = new.user_id and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team2_id
      ) then match.team2_id
      else null
    end
  into target_club_id, target_championship_status, player_team_id
  from public.championship_matches as match
  join public.championship_divisions as division
    on division.id = match.division_id
  join public.championships as championship
    on championship.id = division.championship_id
  join public.reservable_resources as resource
    on resource.id = new.resource_id
  where match.id = new.championship_match_id;

  if target_club_id is null
    or player_team_id is null
    or target_championship_status not in ('preparation', 'active')
  then
    raise exception 'Cette rencontre ne peut pas être réservée sur ce terrain'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    join public.championship_divisions as division
      on division.id = team.division_id
    join public.championship_club_links as club_link
      on club_link.championship_id = division.championship_id
     and club_link.federation_club_id = federation_club.id
     and club_link.club_id = target_club_id
    where team.id = player_team_id
      and federation_club.linked_club_id = target_club_id
  ) then
    raise exception 'Votre équipe n’est pas rattachée au club de ce terrain'
      using errcode = '42501';
  end if;

  return new;
end;
$function$

