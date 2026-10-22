-- Align admin contact resolution with existing tournament participant contact logic.
create or replace function public.admin_calendar_match_contacts(
  target_resource_id uuid, target_starts_at timestamptz, target_ends_at timestamptz
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target_club uuid; match_data jsonb; target_match uuid; target_kind text; contacts jsonb;
begin
  select club_id into target_club from public.reservable_resources where id=target_resource_id;
  if auth.uid() is null or target_club is null
    or not public.has_club_permission(target_club,'reservations.manage') then
    raise exception 'Accès refusé' using errcode='42501';
  end if;
  match_data := public.resolve_calendar_player_actions(target_resource_id,target_starts_at,target_ends_at);
  target_kind := match_data->>'kind';
  if target_kind not in ('championship','tournament') then
    raise exception 'Rencontre non identifiable' using errcode='22023';
  end if;
  target_match := (match_data->>'matchId')::uuid;
  if target_kind='championship' then
    select coalesce(jsonb_agg(jsonb_build_object('name',p.first_name||' '||p.last_name,'phone',c.phone,'team',tp.team_id::text)
      order by tp.team_id,p.last_name,p.first_name),'[]'::jsonb) into contacts
    from public.championship_matches m
    join public.championship_team_players tp on tp.team_id in(m.team1_id,m.team2_id)
    join public.championship_players p on p.id=tp.player_id
    left join public.profiles profile on profile.id=p.profile_id
    left join lateral (
      select nullif(btrim(member.phone),'') as phone
      from public.club_members member
      where nullif(btrim(member.phone),'') is not null
        and ((profile.sport_player_id is not null and member.sport_player_id=profile.sport_player_id)
          or (p.sport_player_id is not null and member.sport_player_id=p.sport_player_id)
          or (profile.sport_player_id is null and p.sport_player_id is null and member.id=profile.member_id))
      order by member.is_active desc,member.updated_at desc limit 1
    ) c on true
    where m.id=target_match;
  else
    select coalesce(jsonb_agg(jsonb_build_object('name',p.first_name||' '||p.last_name,
      'phone',coalesce(nullif(btrim(cm.phone),''),
        case when ident.status='verified' then coalesce(nullif(btrim(ident_member.phone),''),profile_contact.phone) end,
        nullif(btrim(p.phone),'')),
      'team',p.team_id::text) order by p.team_id,p.last_name,p.first_name),'[]'::jsonb) into contacts
    from public.tournament_matches m
    join public.tournament_team_players p on p.team_id in(m.team_a_id,m.team_b_id)
    left join public.club_members cm on cm.id=p.member_id
    left join public.tournament_external_player_identities ident on ident.id=p.external_identity_id
    left join public.club_members ident_member on ident_member.id=ident.member_id
    left join public.profiles ident_profile on ident_profile.id=ident.profile_id
    left join lateral (
      select nullif(btrim(member.phone),'') as phone from public.club_members member
      where nullif(btrim(member.phone),'') is not null and (
        (ident_profile.sport_player_id is not null and member.sport_player_id=ident_profile.sport_player_id)
        or (ident_profile.sport_player_id is null and member.id=ident_profile.member_id))
      order by member.is_active desc,member.updated_at desc,member.id limit 1
    ) profile_contact on true
    where m.id=target_match;
  end if;
  return coalesce(contacts,'[]'::jsonb);
end $$;
revoke all on function public.admin_calendar_match_contacts(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_calendar_match_contacts(uuid,timestamptz,timestamptz) to authenticated;
