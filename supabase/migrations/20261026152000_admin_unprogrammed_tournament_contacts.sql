-- Contacts d'un match à reprogrammer, réservés aux gestionnaires du tournoi.
create or replace function public.admin_unprogrammed_tournament_match_contacts()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'match_id', q.match_id,
    'team_id', p.team_id,
    'name', concat_ws(' ',nullif(btrim(p.first_name),''),nullif(btrim(p.last_name),'')),
    'phone', coalesce(
      nullif(btrim(cm.phone),''),
      case when ext.status='verified' then coalesce(
        nullif(btrim(ext_member.phone),''),
        nullif(btrim(profile_member.phone),'')
      ) end,
      nullif(btrim(p.phone),'')
    )
  ) order by q.match_id,p.team_id,p.last_name,p.first_name),'[]'::jsonb)
  from public.tournament_unprogrammed_matches q
  join public.tournaments t on t.id=q.tournament_id
  join public.tournament_matches m on m.id=q.match_id
  join public.tournament_team_players p on p.team_id in (m.team_a_id,m.team_b_id)
  left join public.club_members cm on cm.id=p.member_id
  left join public.tournament_external_player_identities ext on ext.id=p.external_identity_id
  left join public.club_members ext_member on ext_member.id=ext.member_id
  left join public.profiles profile on profile.id=ext.profile_id
  left join public.club_members profile_member on profile_member.id=profile.member_id
  where auth.uid() is not null
    and t.club_id=public.admin_current_club_id()
    and public.has_club_permission(t.club_id,'tournaments.manage');
$$;
revoke all on function public.admin_unprogrammed_tournament_match_contacts() from public,anon,authenticated;
grant execute on function public.admin_unprogrammed_tournament_match_contacts() to authenticated;
