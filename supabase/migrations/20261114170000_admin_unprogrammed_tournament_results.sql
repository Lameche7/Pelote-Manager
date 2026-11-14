-- Expose the result of an unprogrammed match to the authorized club admin.
-- A result can be entered without inventing a booking date or resource.
create or replace function public.admin_list_unprogrammed_tournament_matches()
returns jsonb
language sql
stable security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'match_id', q.match_id,
    'tournament_id', q.tournament_id,
    'tournament_name', t.name,
    'phase', m.phase,
    'series_name', s.name,
    'team_a', public.tournament_team_public_label(m.team_a_id),
    'team_b', public.tournament_team_public_label(m.team_b_id),
    'previous_date', q.previous_play_date,
    'previous_start', q.previous_starts_at,
    'previous_end', q.previous_ends_at,
    'reason', q.reason,
    'unprogrammed_at', q.unprogrammed_at,
    'result_status', result.status,
    'result_score', result.score,
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object('id', rr.id, 'name', rr.name) order by rr.name)
      from public.tournament_resources tr
      join public.reservable_resources rr on rr.id = tr.resource_id
      where tr.tournament_id = t.id and rr.is_active
    ), '[]'::jsonb)
  ) order by q.unprogrammed_at desc), '[]'::jsonb)
  from public.tournament_unprogrammed_matches q
  join public.tournaments t on t.id = q.tournament_id
  join public.tournament_matches m on m.id = q.match_id
  join public.tournament_series s on s.id = m.series_id
  left join public.tournament_match_results result on result.match_id = m.id
  where t.club_id = public.admin_current_club_id()
    and public.has_club_permission(t.club_id, 'tournaments.manage');
$function$;
