-- List only teams the connected club is authorized to manage.
create or replace function public.admin_list_substitutable_championship_teams(target_championship_id uuid)
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare target_club uuid := public.admin_current_club_id();
begin
 if not public.championship_club_can_manage(target_championship_id,target_club) then
   raise exception 'Forbidden' using errcode='42501';
 end if;
 return array(
  select team.id
  from public.championship_teams team
  join public.championship_divisions division on division.id=team.division_id
  join public.championship_federation_clubs club on club.id=team.federation_club_id
  join public.championship_club_links links
    on links.championship_id=division.championship_id
   and links.federation_club_id=club.id and links.club_id=target_club
  where division.championship_id=target_championship_id
    and club.linked_club_id=target_club
 );
end $$;
revoke all on function public.admin_list_substitutable_championship_teams(uuid) from public,anon;
grant execute on function public.admin_list_substitutable_championship_teams(uuid) to authenticated;

-- Enforce the same championship-specific manage permissions at mutation time.
create or replace function public.admin_substitute_team_authorized(target_team_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists (
  select 1 from public.championship_teams team
  join public.championship_divisions division on division.id=team.division_id
  join public.championship_federation_clubs club on club.id=team.federation_club_id
  join public.championship_club_links links on links.championship_id=division.championship_id
     and links.federation_club_id=club.id and links.club_id=club.linked_club_id
  where team.id=target_team_id
   and club.linked_club_id=public.admin_current_club_id()
   and public.championship_club_can_manage(division.championship_id,club.linked_club_id)
 );
$$;
revoke all on function public.admin_substitute_team_authorized(uuid) from public,anon;
