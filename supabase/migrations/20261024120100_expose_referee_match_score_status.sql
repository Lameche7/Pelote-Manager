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
 join my_clubs mc on mc.club_id=t.club_id
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

