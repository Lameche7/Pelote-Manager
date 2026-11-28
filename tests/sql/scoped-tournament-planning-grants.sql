-- Explicit club-scoped planning endpoints.
grant execute on function public.admin_get_tournament_planning_workspace_for_club(uuid,uuid) to authenticated;
grant execute on function public.admin_prepare_tournament_matches_for_club(uuid,uuid) to authenticated;
grant execute on function public.admin_save_tournament_planning_for_club(uuid,uuid,jsonb) to authenticated;
grant execute on function public.admin_update_tournament_series_colors_for_club(uuid,uuid,jsonb) to authenticated;
