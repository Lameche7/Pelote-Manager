begin;

create or replace function public.championship_reservation_player_is_eligible(
  target_club_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null and exists (
    select 1
    from public.championship_players as player
    join public.championship_team_players as team_player
      on team_player.player_id = player.id
    join public.championship_teams as team
      on team.id = team_player.team_id
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    join public.championship_divisions as division
      on division.id = team.division_id
    join public.championships as championship
      on championship.id = division.championship_id
    join public.championship_club_links as club_link
      on club_link.championship_id = championship.id
     and club_link.federation_club_id = federation_club.id
     and club_link.club_id = target_club_id
    where player.profile_id = target_user_id
      and player.link_status in ('claimed', 'verified')
      and federation_club.linked_club_id = target_club_id
      and championship.status in ('preparation', 'active')
  );
$$;

revoke all on function public.championship_reservation_player_is_eligible(uuid, uuid)
from public, anon, authenticated;

commit;
