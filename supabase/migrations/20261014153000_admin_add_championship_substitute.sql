-- Add a licensed substitute to an existing championship team without removing any player.
create or replace function public.admin_add_championship_substitute(
  target_team_id uuid, target_licence text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owning_club uuid;
  actor_club uuid;
  provider text;
  source_player public.sport_players%rowtype;
  linked_profile uuid;
  target_player_id uuid;
  existing_player uuid;
  linked_license text := btrim(target_licence);
begin
  actor_club := public.admin_current_club_id();
  select fc.linked_club_id,c.source_provider
  into owning_club,provider
  from public.championship_teams t
  join public.championship_federation_clubs fc on fc.id=t.federation_club_id
  join public.championship_divisions d on d.id=t.division_id
  join public.championships c on c.id=d.championship_id
  join public.championship_club_links cl on cl.championship_id=c.id and cl.federation_club_id=fc.id and cl.club_id=fc.linked_club_id
  where t.id=target_team_id;
  if actor_club is null or owning_club is null or owning_club<>actor_club then
    raise exception 'Forbidden championship team' using errcode='42501';
  end if;
  if linked_license is null or linked_license='' then
    raise exception 'Licence required' using errcode='22023';
  end if;
  select sp.* into source_player from public.sport_players sp
  where sp.licence_number=linked_license;
  if not found then raise exception 'Unknown licence' using errcode='22023'; end if;
  select p.id into linked_profile
  from public.profiles p
  join public.club_members cm on cm.id=p.member_id
  where (p.sport_player_id=source_player.id or cm.sport_player_id=source_player.id)
    and cm.club_id=owning_club and cm.is_active
    and public.is_active_licensee_for_club(p.id,owning_club,current_date)
  order by p.id limit 1;
  if linked_profile is null then
    raise exception 'Licence not linked to an active club account' using errcode='22023';
  end if;
  select cp.id into target_player_id from public.championship_players cp
  where cp.source_provider=provider and cp.licence_number=linked_license for update;
  if target_player_id is null then
    insert into public.championship_players(
      source_provider,licence_number,first_name,last_name,normalized_first_name,
      normalized_last_name,profile_id,link_status,linked_at,sport_player_id
    ) values(
      provider,linked_license,source_player.first_name,source_player.last_name,
      public.normalize_member_identity(source_player.first_name),
      public.normalize_member_identity(source_player.last_name),
      linked_profile,'verified',now(),source_player.id
    ) returning id into target_player_id;
  else
    update public.championship_players
    set profile_id=linked_profile,link_status='verified',linked_at=now(),
        sport_player_id=source_player.id,updated_at=now()
    where id=target_player_id
      and (profile_id is null or profile_id=linked_profile);
    if not found then raise exception 'Championship player linked to another account' using errcode='23505'; end if;
  end if;
  insert into public.championship_team_players(team_id,player_id,source_entry,source_flags)
  values(target_team_id,target_player_id,concat(source_player.last_name,' ',source_player.first_name,' (',linked_license,')'),array['substitute']::text[])
  on conflict (team_id,player_id) do nothing;
  return jsonb_build_object('teamId',target_team_id,'profileId',linked_profile,'licenceNumber',linked_license,'playerId',target_player_id);
end $$;
revoke all on function public.admin_add_championship_substitute(uuid,text) from public,anon;
grant execute on function public.admin_add_championship_substitute(uuid,text) to authenticated;
