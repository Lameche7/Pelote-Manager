-- Grant only the reviewed, explicitly club-scoped endpoints.
grant execute on function public.admin_list_tournament_account_audit_for_club(uuid,uuid) to authenticated;
grant execute on function public.admin_search_tournament_account_candidates_for_club(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.admin_link_tournament_account_for_club(uuid,uuid,uuid,uuid) to authenticated;
