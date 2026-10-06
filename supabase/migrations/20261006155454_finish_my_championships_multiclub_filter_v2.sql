do $$
declare
  v_oid oid;
  ddl text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_my_championships'
  limit 1;

  ddl := pg_get_functiondef(v_oid);
  ddl := replace(
    ddl,
    E'where player.profile_id = auth.uid()\n      and player.link_status in (''claimed'', ''verified'')',
    E'where player.profile_id = auth.uid()\n      and player.link_status in (''claimed'', ''verified'')\n      and public.championship_profile_can_act_for_team(team.id, auth.uid())'
  );
  execute ddl;

  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_my_championship_ranking_context'
  limit 1;

  ddl := pg_get_functiondef(v_oid);
  ddl := replace(
    ddl,
    E'where player.profile_id = auth.uid()\n      and player.link_status in (''claimed'', ''verified'')',
    E'where player.profile_id = auth.uid()\n      and player.link_status in (''claimed'', ''verified'')\n      and public.championship_profile_can_act_for_team(team.id, auth.uid())'
  );
  execute ddl;
end $$;
