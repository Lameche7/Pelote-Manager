-- Confirmed participants of a tournament may volunteer at THAT tournament only.
-- Identity must have been verified and linked to an accepted team.
-- No club membership, licence, or cross-club privileges are conferred.
create or replace function public.is_verified_tournament_player(actor uuid, target_tournament_id uuid)
returns boolean language sql stable security definer set search_path = '' as $verified$
 select actor is not null and exists (
   select 1 from public.tournament_team_players tp
   join public.tournament_teams tt on tt.id=tp.team_id and tt.tournament_id=tp.tournament_id
   join public.tournament_external_player_identities ident on ident.id=tp.external_identity_id
   where tp.tournament_id=target_tournament_id
     and tt.status='accepted'
     and ident.status='verified'
     and ident.profile_id=actor
 );
$verified$;
revoke all on function public.is_verified_tournament_player(uuid,uuid) from public,anon,authenticated;

-- Update the tournament arbitration workspace without affecting championship club boundaries.
-- Expose read-only result existence to referee workspace for both match types.
CREATE OR REPLACE FUNCTION public.get_refereeing_workspace()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with my_clubs as(
 select distinct cm.club_id from public.club_memberships cm where cm.profile_id=auth.uid()
 union
 select distinct m.club_id
 from public.profiles p
 join public.club_members m on p.sport_player_id is not null and m.sport_player_id=p.sport_player_id
 where p.id=auth.uid() and m.is_active
),ch as(
 select m.id match_id,mc.club_id,'championship'::text source_type,d.name competition_label,
 concat(t1.source_label,coalesce(' — '||(select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.last_name,p.first_name) from public.championship_team_players tp join public.championship_players p on p.id=tp.player_id where tp.team_id=t1.id),'')) team1_label,
 concat(t2.source_label,coalesce(' — '||(select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.last_name,p.first_name) from public.championship_team_players tp join public.championship_players p on p.id=tp.player_id where tp.team_id=t2.id),'')) team2_label,
 coalesce((r.starts_at at time zone coalesce(rr.timezone,'Europe/Paris'))::date,ms.scheduled_on,m.report_on,m.agreement_on,m.scheduled_on) play_date,
 coalesce((r.starts_at at time zone coalesce(rr.timezone,'Europe/Paris'))::time,ms.scheduled_time,m.report_time,m.agreement_time,m.scheduled_time) play_time,
 coalesce(rr.name,ms.venue,m.agreement_venue,m.venue) venue
 from public.championship_matches m
 join public.championship_teams t1 on t1.id=m.team1_id
 join public.championship_divisions d on d.id=m.division_id
 left join public.championship_teams t2 on t2.id=m.team2_id
 join public.reservations r on r.championship_match_id=m.id and r.status in ('pending','confirmed')
 join public.reservable_resources rr on rr.id=r.resource_id
 join my_clubs mc on mc.club_id=rr.club_id
 join public.championship_club_links cl on cl.championship_id=d.championship_id and cl.club_id=mc.club_id
 left join public.championship_match_manual_schedules ms on ms.match_id=m.id
 where not exists (
   select 1 from public.reservations earlier
   where earlier.championship_match_id=m.id and earlier.status in ('pending','confirmed')
   and (earlier.starts_at,earlier.id)<(r.starts_at,r.id)
 )
),tour as(
 select m.id,t.club_id,'tournament'::text,t.name,
 coalesce((select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.display_order) from public.tournament_team_players p where p.team_id=m.team_a_id),'Équipe A'),
 coalesce((select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.display_order) from public.tournament_team_players p where p.team_id=m.team_b_id),'Équipe B'),
 pl.play_date,pl.starts_at,r.name
 from public.tournament_matches m
 join public.tournaments t on t.id=m.tournament_id and t.refereeing_enabled
 join lateral (select t.club_id where t.club_id in (select club_id from my_clubs) or public.is_verified_tournament_player(auth.uid(),t.id)) mc on true
 join public.tournament_match_planning pl on pl.match_id=m.id
 left join public.reservable_resources r on r.id=pl.resource_id
),x as(select * from ch union all select * from tour)
select coalesce(jsonb_agg(jsonb_build_object(
 'match_id',x.match_id,'club_id',x.club_id,'source_type',x.source_type,'competition_label',x.competition_label,
 'team1_label',x.team1_label,'team2_label',x.team2_label,'play_date',x.play_date,'play_time',x.play_time,'venue',x.venue,
 'referee_profile_id',ra.referee_profile_id,'referee_name',coalesce(pr.display_name,concat_ws(' ',pr.first_name,pr.last_name)),
 'is_mine',ra.referee_profile_id=auth.uid(),
 'has_result',case when x.source_type='championship' then exists(select 1 from public.championship_matches cm where cm.id=x.match_id and (cm.score_raw is not null or cm.score_team1 is not null or cm.score_team2 is not null or exists(select 1 from public.championship_result_submissions cs where cs.match_id=cm.id and cs.status in ('pending','confirmed_official')))) else exists(select 1 from public.tournament_match_results tr where tr.match_id=x.match_id) end,
 'my_count',(select count(*) from public.referee_slot_assignments z where z.club_id=x.club_id and z.referee_profile_id=auth.uid())
) order by x.play_date nulls last,x.play_time nulls last),'[]'::jsonb)
from x
left join lateral public.refereeing_current_match_slot(x.source_type,x.match_id) slot on true
left join public.referee_slot_assignments ra
  on ra.club_id=slot.club_id and ra.resource_id=slot.resource_id
 and ra.starts_at=slot.starts_at and ra.ends_at=slot.ends_at
left join public.profiles pr on pr.id=ra.referee_profile_id;
$function$


-- Restore the intended no-licence rule for club affiliates and add verified tournament participants.
-- Allow club-affiliated Pilotoki accounts to volunteer as referees without an active licence.
-- Applies equally to championship and tournament matches; never grants access to other clubs.
create or replace function public.volunteer_for_refereeing(
 target_source_type text, target_match_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
 s record;
 actor uuid := auth.uid();
begin
 if actor is null then
   raise exception 'Connexion requise' using errcode = '42501';
 end if;
 select * into s from public.refereeing_current_match_slot(target_source_type,target_match_id);
 if not found or not (
   exists (
     select 1 from public.club_memberships cm
     where cm.profile_id = actor and cm.club_id = s.club_id
   )
   or exists (
     select 1 from public.profiles p
     join public.club_members m on m.sport_player_id = p.sport_player_id
     where p.id = actor and p.sport_player_id is not null
       and m.club_id = s.club_id and m.is_active
   )
   or (target_source_type = 'tournament' and exists (
     select 1 from public.tournament_matches tm
     where tm.id = target_match_id
       and public.is_verified_tournament_player(actor,tm.tournament_id)
   ))
 ) then
   raise exception 'Arbitrage non disponible pour ce club' using errcode = '42501';
 end if;
 insert into public.referee_slot_assignments
   (club_id,resource_id,starts_at,ends_at,referee_profile_id,assigned_by)
 values (s.club_id,s.resource_id,s.starts_at,s.ends_at,actor,actor);
exception when unique_violation then
 raise exception 'Ce créneau possède déjà un arbitre.';
end $$;
revoke all on function public.volunteer_for_refereeing(text,uuid) from public,anon;
grant execute on function public.volunteer_for_refereeing(text,uuid) to authenticated;

-- Administrators may also assign club-affiliated volunteers who no longer hold a licence.
create or replace function public.admin_set_referee(
 target_source_type text,target_match_id uuid,target_profile_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare s record; current_club uuid := public.admin_current_club_id();
begin
 if auth.uid() is null or current_club is null
 or not public.has_club_permission(current_club,'championships.manage')
 then raise exception 'Accès refusé' using errcode='42501'; end if;
 select * into s from public.refereeing_current_match_slot(target_source_type,target_match_id);
 if not found or s.club_id <> current_club then
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
   or (target_source_type = 'tournament' and exists (
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
end $$;
revoke all on function public.admin_set_referee(text,uuid,uuid) from public,anon;
grant execute on function public.admin_set_referee(text,uuid,uuid) to authenticated;
