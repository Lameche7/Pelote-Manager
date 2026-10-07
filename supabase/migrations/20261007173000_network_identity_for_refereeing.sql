-- Network identity for refereeing.
-- A player's club comes from sport_player affiliation; club_memberships remains for admin permissions.
create or replace function public.get_refereeing_workspace()
returns jsonb language sql stable security definer set search_path to ''
as $function$
with my_clubs as(
 select distinct cm.club_id from public.club_memberships cm where cm.profile_id=auth.uid()
 union
 select distinct m.club_id from public.profiles p join public.club_members m on p.sport_player_id is not null and m.sport_player_id=p.sport_player_id where p.id=auth.uid() and m.is_active
),
ch as(
 select m.id match_id,cl.club_id,'championship'::text source_type,d.name competition_label,t1.source_label team1_label,t2.source_label team2_label,
 coalesce(ms.scheduled_on,m.report_on,m.agreement_on,m.scheduled_on) play_date,coalesce(ms.scheduled_time,m.report_time,m.agreement_time,m.scheduled_time) play_time,coalesce(ms.venue,m.agreement_venue,m.venue) venue
 from public.championship_matches m join public.championship_teams t1 on t1.id=m.team1_id join public.championship_federation_clubs fc on fc.id=t1.federation_club_id
 join public.championship_divisions d on d.id=m.division_id join public.championship_club_links cl on cl.championship_id=d.championship_id and cl.club_id=fc.linked_club_id
 join my_clubs mc on mc.club_id=cl.club_id left join public.championship_teams t2 on t2.id=m.team2_id left join public.championship_match_manual_schedules ms on ms.match_id=m.id
),
tour as(
 select m.id,t.club_id,'tournament'::text,t.name,
 coalesce((select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.display_order) from public.tournament_team_players p where p.team_id=m.team_a_id),'Équipe A'),
 coalesce((select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.display_order) from public.tournament_team_players p where p.team_id=m.team_b_id),'Équipe B'),pl.play_date,pl.starts_at,r.name
 from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id and t.refereeing_enabled join my_clubs mc on mc.club_id=t.club_id join public.tournament_match_planning pl on pl.match_id=m.id left join public.reservable_resources r on r.id=pl.resource_id
),x as(select * from ch union all select * from tour)
select coalesce(jsonb_agg(jsonb_build_object('match_id',x.match_id,'club_id',x.club_id,'source_type',x.source_type,'competition_label',x.competition_label,'team1_label',x.team1_label,'team2_label',x.team2_label,'play_date',x.play_date,'play_time',x.play_time,'venue',x.venue,'referee_profile_id',ra.referee_profile_id,'referee_name',coalesce(pr.display_name,concat_ws(' ',pr.first_name,pr.last_name)),'is_mine',ra.referee_profile_id=auth.uid(),'my_count',(select count(*) from public.referee_assignments z where z.club_id=x.club_id and z.referee_profile_id=auth.uid())) order by x.play_date nulls last,x.play_time nulls last),'[]'::jsonb)
from x left join public.referee_assignments ra on (x.source_type='championship' and ra.championship_match_id=x.match_id) or(x.source_type='tournament' and ra.tournament_match_id=x.match_id) left join public.profiles pr on pr.id=ra.referee_profile_id;
$function$;
revoke all on function public.get_refereeing_workspace() from public;
grant execute on function public.get_refereeing_workspace() to authenticated;

create or replace function public.list_refereeing_participation()
returns table(member_id uuid,player_name text,arbitration_count bigint,total_licensed bigint,different_referees bigint)
language sql stable security definer set search_path to ''
as $function$
with my_clubs as(
 select distinct cm.club_id from public.club_memberships cm where cm.profile_id=auth.uid()
 union
 select distinct m.club_id from public.profiles p join public.club_members m on p.sport_player_id is not null and m.sport_player_id=p.sport_player_id where p.id=auth.uid() and m.is_active
),active_season as(
 select cs.id,cs.club_id from public.club_seasons cs join my_clubs mc on mc.club_id=cs.club_id where cs.is_active=true
),licensed as(
 select m.id,m.first_name,m.last_name,m.sport_player_id,m.club_id from public.club_members m join public.club_member_seasons ms on ms.club_member_id=m.id join active_season s on s.id=ms.club_season_id and s.club_id=ms.club_id where ms.is_licensed=true and m.is_active=true
),linked as(select l.*,p.id profile_id from licensed l left join public.profiles p on p.sport_player_id=l.sport_player_id),
counts as(select ra.club_id,ra.referee_profile_id,count(*)::bigint arbitration_count from public.referee_assignments ra join my_clubs mc on mc.club_id=ra.club_id where ra.referee_profile_id is not null group by ra.club_id,ra.referee_profile_id),
summary as(select count(*)::bigint total_licensed,count(*) filter(where coalesce(c.arbitration_count,0)>0)::bigint different_referees from linked l left join counts c on c.club_id=l.club_id and c.referee_profile_id=l.profile_id)
select l.id,concat_ws(' ',l.first_name,l.last_name),coalesce(c.arbitration_count,0)::bigint,s.total_licensed,s.different_referees from linked l left join counts c on c.club_id=l.club_id and c.referee_profile_id=l.profile_id cross join summary s order by coalesce(c.arbitration_count,0) desc,l.last_name,l.first_name;
$function$;
revoke all on function public.list_refereeing_participation() from public;
grant execute on function public.list_refereeing_participation() to authenticated;
