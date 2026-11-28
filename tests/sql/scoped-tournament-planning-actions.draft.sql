-- Tournament-only planning contacts and referee assignments.
CREATE OR REPLACE FUNCTION public.admin_tournament_calendar_contacts_for_club(target_club_id uuid, target_resource_id uuid, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target_club uuid; match_data jsonb; target_match uuid; target_kind text; contacts jsonb;
begin
  select club_id into target_club from public.reservable_resources where id=target_resource_id;
  if not (auth.uid() is not null and target_club_id is not null and (coalesce(public.can_administer_club(target_club_id, 'tournaments.manage'),false) or coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id),false))) or target_club is distinct from target_club_id then
    raise exception 'Accès refusé' using errcode='42501';
  end if;
  match_data := public.resolve_calendar_player_actions(target_resource_id,target_starts_at,target_ends_at);
  target_kind := match_data->>'kind';
  if target_kind is distinct from 'tournament' then
    raise exception 'Rencontre non identifiable' using errcode='22023';
  end if;
  target_match := (match_data->>'matchId')::uuid;
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
    where m.id=target_match and exists (select 1 from public.tournaments t where t.id=m.tournament_id and t.club_id=target_club_id);
  return coalesce(contacts,'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.admin_set_tournament_referee_for_club(target_club_id uuid, target_match_id uuid, target_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s record; current_club uuid := target_club_id;
begin
 if not (auth.uid() is not null and target_club_id is not null and (coalesce(public.can_administer_club(target_club_id, 'tournaments.manage'),false) or coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id),false)))
 then raise exception 'Accès refusé' using errcode='42501'; end if;
 select * into s from public.refereeing_current_match_slot('tournament',target_match_id);
 if not found or s.club_id is distinct from current_club or not exists (select 1 from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id where m.id=target_match_id and t.club_id=target_club_id) then
   raise exception 'Partie extérieure ou sans créneau' using errcode='42501';
 end if;
 if target_profile_id is not null and not (
   exists (
     select 1 from public.club_memberships cm
     where cm.profile_id = target_profile_id and cm.club_id = current_club
   )
   or exists (
     select 1 from public.profiles p
     join public.club_members m on m.sport_player_id = p.sport_player_id
     where p.id = target_profile_id and p.sport_player_id is not null
       and m.club_id = current_club and m.is_active
   )
   or ('tournament' = 'tournament' and exists (
     select 1 from public.tournament_matches tm
     where tm.id=target_match_id
       and public.is_verified_tournament_player(target_profile_id,tm.tournament_id)
   ))
 ) then raise exception 'Membre non disponible'; end if;
 perform pg_advisory_xact_lock(hashtextextended(s.resource_id::text||s.starts_at::text,0));
 if target_profile_id is null then
   delete from public.referee_slot_assignments a
   where a.resource_id=s.resource_id and a.starts_at=s.starts_at and a.club_id=s.club_id;
 else
   insert into public.referee_slot_assignments
     (club_id,resource_id,starts_at,ends_at,referee_profile_id,assigned_by,assigned_at)
   values(s.club_id,s.resource_id,s.starts_at,s.ends_at,target_profile_id,auth.uid(),now())
   on conflict (resource_id,starts_at) do update
   set referee_profile_id=excluded.referee_profile_id,
       assigned_by=excluded.assigned_by,assigned_at=now(),updated_at=now()
   where public.referee_slot_assignments.club_id=excluded.club_id
     and public.referee_slot_assignments.ends_at=excluded.ends_at;
   if not found then raise exception 'Conflit de créneau'; end if;
 end if;
end $function$;

CREATE OR REPLACE FUNCTION public.list_tournament_referee_candidates_for_club(target_club_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with c as(select target_club_id id)
select case when (auth.uid() is not null and target_club_id is not null and (coalesce(public.can_administer_club(target_club_id, 'tournaments.manage'),false) or coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id),false))) then
 coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',concat_ws(' ',cm.first_name,cm.last_name),'count',(select count(*) from public.referee_assignments ra where ra.club_id=c.id and ra.referee_profile_id=p.id)) order by cm.last_name,cm.first_name),'[]'::jsonb)
 else '[]'::jsonb end
from c join public.club_members cm on cm.club_id=c.id and cm.is_active join public.profiles p on p.member_id=cm.id group by c.id;
$function$;
revoke all on function public.admin_tournament_calendar_contacts_for_club(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_tournament_calendar_contacts_for_club(uuid, uuid, timestamptz, timestamptz) to authenticated;
revoke all on function public.admin_set_tournament_referee_for_club(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_tournament_referee_for_club(uuid, uuid, uuid) to authenticated;
revoke all on function public.list_tournament_referee_candidates_for_club(uuid) from public, anon, authenticated;
grant execute on function public.list_tournament_referee_candidates_for_club(uuid) to authenticated;
