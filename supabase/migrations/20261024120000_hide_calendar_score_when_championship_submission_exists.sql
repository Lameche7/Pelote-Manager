-- Prevent duplicate score entry when a championship submission is pending or confirmed.
CREATE OR REPLACE FUNCTION public.resolve_calendar_player_actions(target_resource_id uuid, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with viewer as (
 select p.id profile_id, p.member_id, p.sport_player_id
 from public.profiles p where p.id = auth.uid()
), resource as (
 select rr.id,rr.club_id,coalesce(rr.timezone,'Europe/Paris') timezone
 from public.reservable_resources rr where rr.id=target_resource_id
), matches as (
 select 'championship'::text kind, rv.championship_match_id match_id,
   rv.starts_at,rv.ends_at
 from public.reservations rv
 where rv.resource_id=target_resource_id and rv.status in ('pending','confirmed')
   and rv.championship_match_id is not null
   and rv.starts_at=target_starts_at and rv.ends_at=target_ends_at
 union all
 select 'tournament'::text, pl.match_id,
   public.tournament_planning_starts_at(pl.play_date,pl.starts_at,r.timezone),
   public.tournament_planning_starts_at(pl.play_date,pl.ends_at,r.timezone)
 from public.tournament_match_planning pl
 join resource r on r.id=pl.resource_id
 where pl.resource_id=target_resource_id
   and public.tournament_planning_starts_at(pl.play_date,pl.starts_at,r.timezone)=target_starts_at
   and public.tournament_planning_starts_at(pl.play_date,pl.ends_at,r.timezone)=target_ends_at
), unique_match as (
 select m.* from matches m where (select count(*) from matches)=1
), eligibility as (
 select m.kind,m.match_id,
  case when m.kind='championship' then exists(
    select 1 from public.championship_matches cm
    join public.championship_team_players ctp on ctp.team_id in(cm.team1_id,cm.team2_id)
    join public.championship_players cp on cp.id=ctp.player_id
    cross join viewer v
    where cm.id=m.match_id and
      (cp.profile_id=v.profile_id or
       (v.sport_player_id is not null and cp.sport_player_id=v.sport_player_id))
  ) else exists(
    select 1 from public.tournament_matches tm
    join public.tournament_team_players tp on tp.team_id in(tm.team_a_id,tm.team_b_id)
    left join public.club_members cm on cm.id=tp.member_id
    cross join viewer v
    where tm.id=m.match_id and (
      tp.member_id=v.member_id or
      (v.sport_player_id is not null and cm.sport_player_id=v.sport_player_id)
    )
  ) end is_participant,
  exists(
    select 1 from public.referee_slot_assignments ra
    join resource r on r.id=ra.resource_id and r.club_id=ra.club_id
    where ra.resource_id=target_resource_id
      and ra.starts_at=target_starts_at and ra.ends_at=target_ends_at
      and ra.referee_profile_id=auth.uid()
  ) is_assigned_referee,
  not exists(
    select 1 from public.referee_slot_assignments ra
    where ra.resource_id=target_resource_id and ra.starts_at=target_starts_at
  ) and (
    exists(
      select 1 from public.club_memberships membership
      join resource r on r.club_id=membership.club_id
      where membership.profile_id=auth.uid()
    ) or exists(
      select 1 from viewer v
      join public.club_members member on member.sport_player_id=v.sport_player_id and member.is_active
      join resource r on r.club_id=member.club_id
      where v.sport_player_id is not null
    )
  ) can_volunteer,
  case when m.kind='championship' then exists(
    select 1 from public.championship_matches cm
    where cm.id=m.match_id and (cm.score_team1 is not null or cm.score_team2 is not null or cm.score_raw is not null or cm.status='played' or exists (select 1 from public.championship_result_submissions crs where crs.match_id=cm.id and crs.status in ('pending','confirmed_official')))
  ) else exists(
    select 1 from public.tournament_match_results tr where tr.match_id=m.match_id
  ) end has_result
 from unique_match m
)
select coalesce((
 select jsonb_build_object(
   'kind',e.kind,'matchId',e.match_id,
   'isParticipant',e.is_participant,
   'isAssignedReferee',e.is_assigned_referee,
   'canVolunteerForRefereeing',e.can_volunteer,
   'hasResult',e.has_result,
   'canSubmitResultNow',target_ends_at<=now(),
   'canRequestReport',target_starts_at>now() and e.is_participant
 ) from eligibility e
), 'null'::jsonb);
$function$

