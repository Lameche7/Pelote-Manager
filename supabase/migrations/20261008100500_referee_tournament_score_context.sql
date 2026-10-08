create or replace function public.get_referee_tournament_score_context(target_match_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('match_format',rules.match_format,'single_game_points',rules.single_game_points,'main_set_points',rules.main_set_points,'deciding_set_points',rules.deciding_set_points,'ends_at',pl.ends_at,'has_result',exists(select 1 from public.tournament_match_results mr where mr.match_id=m.id))
from public.tournament_matches m join public.tournaments t on t.id=m.tournament_id join public.tournament_sporting_rules rules on rules.tournament_id=t.id join public.tournament_match_planning pl on pl.match_id=m.id
join public.referee_assignments ra on ra.tournament_match_id=m.id and ra.referee_profile_id=auth.uid() and ra.club_id=t.club_id
where m.id=target_match_id and t.refereeing_enabled;
$$;
revoke all on function public.get_referee_tournament_score_context(uuid) from public;
grant execute on function public.get_referee_tournament_score_context(uuid) to authenticated;