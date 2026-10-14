-- Dedicated club-scoped dashboard. The super-admin view can use its own
-- separate endpoint later; no league-wide team/match data is sent to club screens.
create or replace function public.admin_get_club_championship_detail(target_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  base jsonb;
  club_id uuid := public.admin_current_club_id();
  own_team_ids uuid[];
begin
  if not public.championship_club_can_manage(target_id, club_id) then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  base := public.admin_get_championship_detail(target_id);
  select coalesce(array_agg(team.id),'{}'::uuid[]) into own_team_ids
  from public.championship_teams team
  join public.championship_divisions division on division.id=team.division_id
  join public.championship_federation_clubs club on club.id=team.federation_club_id
  join public.championship_club_links links
    on links.championship_id=target_id
   and links.federation_club_id=club.id
   and links.club_id=club_id
  where division.championship_id=target_id and club.linked_club_id=club_id;
  return jsonb_set(
    jsonb_set(base,'{teams}',
      coalesce((select jsonb_agg(team.value) from jsonb_array_elements(base->'teams') team(value)
        where (team.value->>'id')::uuid=any(own_team_ids)),'[]'::jsonb)
    ),
    '{matches}',
    coalesce((select jsonb_agg(match.value) from jsonb_array_elements(base->'matches') match(value)
      where (match.value->>'team1_id')::uuid=any(own_team_ids)
         or (match.value->>'team2_id')::uuid=any(own_team_ids)),'[]'::jsonb)
  );
end $$;
revoke all on function public.admin_get_club_championship_detail(uuid) from public,anon;
grant execute on function public.admin_get_club_championship_detail(uuid) to authenticated;
