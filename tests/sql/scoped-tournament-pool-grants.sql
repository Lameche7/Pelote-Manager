-- Explicit club-scoped pool operations: authenticated callers only.
grant execute on function public.admin_get_tournament_pool_workspace_v2_for_club(uuid,uuid) to authenticated;
grant execute on function public.admin_save_tournament_pools_for_club(uuid,uuid,jsonb) to authenticated;
grant execute on function public.admin_validate_tournament_pools_for_club(uuid,uuid) to authenticated;
grant execute on function public.admin_reopen_tournament_pools_for_club(uuid,uuid) to authenticated;
