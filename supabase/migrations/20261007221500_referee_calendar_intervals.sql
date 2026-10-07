-- Expose only refereed calendar intervals to authenticated members of the resource club.
-- Covers both championship reservations and tournament planning without granting raw table access.
create or replace function public.list_refereed_calendar_intervals(
 target_resource_id uuid,
 range_start timestamptz,
 range_end timestamptz
)
returns table(starts_at timestamptz,ends_at timestamptz,source_type text)
language sql stable security definer set search_path to ''
as $function$
with resource as(
 select r.id,r.club_id,coalesce(r.timezone,'Europe/Paris') timezone
 from public.reservable_resources r
 where r.id=target_resource_id
),allowed as(
 select r.*
 from resource r
 where exists(
  select 1 from public.club_memberships cm
  where cm.club_id=r.club_id and cm.profile_id=auth.uid()
 )
 or exists(
  select 1
  from public.profiles p
  join public.club_members m on p.sport_player_id is not null and m.sport_player_id=p.sport_player_id
  where p.id=auth.uid() and m.club_id=r.club_id and m.is_active
 )
),championship as(
 select rv.starts_at,rv.ends_at,'championship'::text source_type
 from allowed a
 join public.reservations rv on rv.resource_id=a.id
 join public.referee_assignments ra on ra.club_id=a.club_id and ra.championship_match_id=rv.championship_match_id and ra.referee_profile_id is not null
 where rv.status in ('pending','confirmed')
   and rv.championship_match_id is not null
   and rv.starts_at<range_end and rv.ends_at>range_start
),tournament as(
 select
  (pl.play_date+pl.starts_at) at time zone a.timezone starts_at,
  (pl.play_date+pl.ends_at) at time zone a.timezone ends_at,
  'tournament'::text source_type
 from allowed a
 join public.tournament_match_planning pl on pl.resource_id=a.id
 join public.referee_assignments ra on ra.club_id=a.club_id and ra.tournament_match_id=pl.match_id and ra.referee_profile_id is not null
 where ((pl.play_date+pl.starts_at) at time zone a.timezone)<range_end
   and ((pl.play_date+pl.ends_at) at time zone a.timezone)>range_start
)
select * from championship
union all
select * from tournament
order by starts_at;
$function$;
revoke all on function public.list_refereed_calendar_intervals(uuid,timestamptz,timestamptz) from public;
grant execute on function public.list_refereed_calendar_intervals(uuid,timestamptz,timestamptz) to authenticated;
