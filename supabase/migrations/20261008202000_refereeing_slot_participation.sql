-- #327 Participation is counted against referee slot assignments.
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
counts as(select ra.club_id,ra.referee_profile_id,count(*)::bigint arbitration_count from public.referee_slot_assignments ra join my_clubs mc on mc.club_id=ra.club_id where ra.referee_profile_id is not null group by ra.club_id,ra.referee_profile_id),
summary as(select count(*)::bigint total_licensed,count(*) filter(where coalesce(c.arbitration_count,0)>0)::bigint different_referees from linked l left join counts c on c.club_id=l.club_id and c.referee_profile_id=l.profile_id)
select l.id,concat_ws(' ',l.first_name,l.last_name),coalesce(c.arbitration_count,0)::bigint,s.total_licensed,s.different_referees from linked l left join counts c on c.club_id=l.club_id and c.referee_profile_id=l.profile_id cross join summary s order by coalesce(c.arbitration_count,0) desc,l.last_name,l.first_name;
$function$;
revoke all on function public.list_refereeing_participation() from public;
grant execute on function public.list_refereeing_participation() to authenticated;
