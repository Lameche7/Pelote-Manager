-- #327 Phase 2: canonical current slot resolver shared by all refereeing RPCs.
-- A match identifies the CURRENT venue/time only; the referee belongs to
-- that slot. This function never changes or moves referee assignments.
create or replace function public.refereeing_current_match_slot(
  target_source_type text, target_match_id uuid
)
returns table (
  club_id uuid, resource_id uuid, starts_at timestamptz, ends_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$
  select t.club_id, pl.resource_id,
         public.tournament_planning_starts_at(pl.play_date,pl.starts_at,rr.timezone),
         public.tournament_planning_starts_at(pl.play_date,pl.ends_at,rr.timezone)
  from public.tournament_match_planning pl
  join public.tournament_matches tm on tm.id=pl.match_id
  join public.tournaments t on t.id=tm.tournament_id and t.refereeing_enabled
  join public.reservable_resources rr on rr.id=pl.resource_id and rr.club_id=t.club_id
  where target_source_type='tournament' and pl.match_id=target_match_id
  union all
  select rr.club_id,r.resource_id,r.starts_at,r.ends_at
  from public.reservations r
  join public.reservable_resources rr on rr.id=r.resource_id
  join public.championship_matches cm on cm.id=r.championship_match_id
  join public.championship_divisions d on d.id=cm.division_id
  join public.championship_club_links cl on cl.championship_id=d.championship_id and cl.club_id=rr.club_id
  where target_source_type='championship'
    and r.championship_match_id=target_match_id and r.status in ('pending','confirmed')
    and not exists (
      select 1 from public.reservations earlier
      where earlier.championship_match_id=r.championship_match_id
        and earlier.status in ('pending','confirmed')
        and (earlier.starts_at,earlier.id)<(r.starts_at,r.id)
    );
$$;
-- Deliberately internal: SECURITY DEFINER callers must independently check
-- authentication and club membership/administration before using this resolver.
revoke all on function public.refereeing_current_match_slot(text,uuid)
  from public,anon,authenticated;
