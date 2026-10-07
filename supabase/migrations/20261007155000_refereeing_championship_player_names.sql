-- Show the exact championship players on refereeing cards.
-- Teams are resolved by team id, never by their non-unique source label.
create or replace function public.get_refereeing_workspace()
returns jsonb language sql stable security definer set search_path to ''
as $function$
with my_clubs as(
 select distinct cm.club_id from public.club_memberships cm where cm.profile_id=auth.uid()
 union
 select distinct m.club_id from public.profiles p join public.club_members m on p.sport_player_id is not null and m.sport_player_id=p.sport_player_id where p.id=auth.uid() and m.is_active
),ch as(
 select m.id match_id,cl.club_id,'championship'::text source_type,d.name competition_label,
 concat(t1.source_label,coalesce(' — '||(select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.last_name,p.first_name) from public.championship_team_players tp join public.championship_players p on p.id=tp.player_id where tp.team_id=t1.id),'')) team1_label,
 concat(t2.source_label,coalesce(' — '||(select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.last_name,p.first_name) from public.championship_team_players tp join public.championship_players p on p.id=tp.player_id where tp.team_id=t2.id),'')) team2_label,
 coalesce(ms.scheduled_on,m.report_on,m.agreement_on,m.scheduled_on) play_date,coalesce(ms.scheduled_time,m.report_time,m.agreement_time,m.scheduled_time) play_time,coalesce(ms.venue,m.agreement_venue,m.venue) venue
 from public.championship_matches m join public.championship_teams t1 on t1.id=m.team1_id join public.championship_federation_clubs fc on fc.id=t1.federation_club_id join public.championship_divisions d on d.id=m.division_id join public.championship_club_links cl on cl.championship_id=d.championship_id and cl.club_id=fc.linked_club_id join my_clubs mc on mc.club_id=cl.club_id left join public.championship_teams t2 on t2.id=m.team2_id left join public.championship_match_manual_schedules ms on ms.match_id=m.id
),tour as(
 select m.id,t.club_id,'tournament'::text,t.name,
 coalesce((select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.display_order) from public.tournament_team_players p where p.team_id=m.team_a_id),'Équipe A'),
 coalesce((select string_agg(concat_ws(' ',p.first_name,p.last_name),' / ' order by p.display_order) from public.tournament_team_players p where p.team_id=m.team_b_id),'Équipe B'),pl.play_date,pl.starts_at,r.name
 from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id and t.refereeing_enabled join my_clubs mc on mc.club_id=t.club_id join public.tournament_match_planning pl on pl.match_id=m.id left join public.reservable_resources r on r.id=pl.resource_id
),x as(select * from ch union all select * from tour)
select coalesce(jsonb_agg(jsonb_build_object('match_id',x.match_id,'club_id',x.club_id,'source_type',x.source_type,'competition_label',x.competition_label,'team1_label',x.team1_label,'team2_label',x.team2_label,'play_date',x.play_date,'play_time',x.play_time,'venue',x.venue,'referee_profile_id',ra.referee_profile_id,'referee_name',coalesce(pr.display_name,concat_ws(' ',pr.first_name,pr.last_name)),'is_mine',ra.referee_profile_id=auth.uid(),'my_count',(select count(*) from public.referee_assignments z where z.club_id=x.club_id and z.referee_profile_id=auth.uid())) order by x.play_date nulls last,x.play_time nulls last),'[]'::jsonb)
from x left join public.referee_assignments ra on (x.source_type='championship' and ra.championship_match_id=x.match_id) or(x.source_type='tournament' and ra.tournament_match_id=x.match_id) left join public.profiles pr on pr.id=ra.referee_profile_id;
$function$;
