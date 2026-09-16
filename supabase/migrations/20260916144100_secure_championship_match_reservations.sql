begin;

create or replace function public.validate_championship_match_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  target_championship_status public.championship_status;
  player_team_id uuid;
begin
  if new.championship_match_id is null then
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
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = new.user_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = new.user_id
          and player.link_status in ('claimed', 'verified')
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
$$;

revoke all on function public.validate_championship_match_reservation()
from public, anon, authenticated;

drop trigger if exists validate_championship_match_reservation
on public.reservations;
create trigger validate_championship_match_reservation
before insert or update of championship_match_id, resource_id, user_id
on public.reservations
for each row
when (new.championship_match_id is not null)
execute function public.validate_championship_match_reservation();

commit;
