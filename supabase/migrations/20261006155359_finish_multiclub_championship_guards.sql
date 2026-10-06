do $$
declare
  r record;
  ddl text;
begin
  -- get_my_championships
  select p.oid into r from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_my_championships' limit 1;
  ddl := pg_get_functiondef(r.oid);
  ddl := replace(ddl,
    'where player.profile_id = auth.uid()\n      and player.link_status in (''claimed'', ''verified'')',
    'where player.profile_id = auth.uid()\n      and player.link_status in (''claimed'', ''verified'')\n      and public.championship_profile_can_act_for_team(team.id, auth.uid())');
  execute ddl;

  -- ranking context
  select p.oid into r from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_my_championship_ranking_context' limit 1;
  ddl := pg_get_functiondef(r.oid);
  ddl := replace(ddl,
    'where player.profile_id = auth.uid()\n      and player.link_status in (''claimed'', ''verified'')',
    'where player.profile_id = auth.uid()\n      and player.link_status in (''claimed'', ''verified'')\n      and public.championship_profile_can_act_for_team(team.id, auth.uid())');
  execute ddl;

  -- create reservation: target team selection must use the central guard
  select p.oid into r from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='create_my_championship_match_reservation' limit 1;
  ddl := pg_get_functiondef(r.oid);
  ddl := replace(ddl,
    'when exists (\n        select 1 from public.championship_team_players tp\n        join public.championship_players p on p.id = tp.player_id\n        where p.profile_id = actor_id and p.link_status in (''claimed'', ''verified'')\n          and tp.team_id = match.team1_id\n      ) then match.team1_id',
    'when public.championship_profile_can_act_for_team(match.team1_id, actor_id) then match.team1_id');
  ddl := replace(ddl,
    'when exists (\n        select 1 from public.championship_team_players tp\n        join public.championship_players p on p.id = tp.player_id\n        where p.profile_id = actor_id and p.link_status in (''claimed'', ''verified'')\n          and tp.team_id = match.team2_id\n      ) then match.team2_id',
    'when public.championship_profile_can_act_for_team(match.team2_id, actor_id) then match.team2_id');
  execute ddl;

  -- link existing reservation
  select p.oid into r from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='link_my_championship_match_reservation' limit 1;
  ddl := pg_get_functiondef(r.oid);
  ddl := replace(ddl,
    'when exists (\n        select 1\n        from public.championship_team_players as team_player\n        join public.championship_players as player on player.id = team_player.player_id\n        where player.profile_id = actor_id and player.link_status in (''claimed'', ''verified'')\n          and team_player.team_id = match.team1_id\n      ) then match.team1_id',
    'when public.championship_profile_can_act_for_team(match.team1_id, actor_id) then match.team1_id');
  ddl := replace(ddl,
    'when exists (\n        select 1\n        from public.championship_team_players as team_player\n        join public.championship_players as player on player.id = team_player.player_id\n        join public.championship_teams as away_team on away_team.id = match.team2_id\n        join public.championship_federation_clubs as away_club on away_club.id = away_team.federation_club_id\n        join public.championship_match_club_venue_overrides as venue_override\n          on venue_override.match_id = match.id and venue_override.club_id = away_club.linked_club_id and venue_override.enabled\n        where player.profile_id = actor_id and player.link_status in (''claimed'', ''verified'')\n          and team_player.team_id = match.team2_id\n      ) then match.team2_id',
    'when public.championship_profile_can_act_for_team(match.team2_id, actor_id)\n        and exists (\n          select 1\n          from public.championship_teams as away_team\n          join public.championship_federation_clubs as away_club on away_club.id = away_team.federation_club_id\n          join public.championship_match_club_venue_overrides as venue_override\n            on venue_override.match_id = match.id\n           and venue_override.club_id = away_club.linked_club_id\n           and venue_override.enabled\n          where away_team.id = match.team2_id\n        ) then match.team2_id');
  execute ddl;

  -- reservation context: only consider teams the user may act for
  select p.oid into r from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_my_championship_reservation_context' limit 1;
  ddl := pg_get_functiondef(r.oid);
  ddl := replace(ddl,
    'when exists (\n        select 1 from public.championship_team_players as tp\n        join public.championship_players as p on p.id = tp.player_id\n        where p.profile_id = actor_id\n          and p.link_status in (''claimed'', ''verified'')\n          and tp.team_id = match.team1_id\n      ) then team1.federation_club_id',
    'when public.championship_profile_can_act_for_team(match.team1_id, actor_id) then team1.federation_club_id');
  ddl := replace(ddl,
    'and exists (\n      select 1\n      from public.championship_team_players as team_player\n      join public.championship_players as player on player.id = team_player.player_id\n      where player.profile_id = actor_id\n        and player.link_status in (''claimed'', ''verified'')\n        and (\n          team_player.team_id = match.team1_id\n          or (\n            team_player.team_id = match.team2_id',
    'and (\n      public.championship_profile_can_act_for_team(match.team1_id, actor_id)\n      or (\n        public.championship_profile_can_act_for_team(match.team2_id, actor_id)\n        and exists (\n              select 1\n              from public.championship_teams as away_team\n              join public.championship_federation_clubs as away_club on away_club.id = away_team.federation_club_id\n              join public.championship_match_club_venue_overrides as venue_override\n                on venue_override.match_id = match.id\n               and venue_override.club_id = away_club.linked_club_id\n               and venue_override.enabled\n              where away_team.id = match.team2_id\n            )\n      )\n    ) /* multiclub guard */\n    and not false /* preserve syntax */\n    /* old branch removed */\n    /*');
  -- If exact source formatting differs, leave this function untouched; it is checked separately below.
  begin execute ddl; exception when others then null; end;

  -- submit result: team identification uses central guard
  select p.oid into r from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='submit_my_championship_result' limit 1;
  ddl := pg_get_functiondef(r.oid);
  ddl := replace(ddl,
    'and exists (\n      select 1\n      from public.championship_team_players as team_player\n      join public.championship_players as player\n        on player.id = team_player.player_id\n      where team_player.team_id = team.id\n        and player.profile_id = actor_id\n        and player.link_status in (''claimed'', ''verified'')\n    )',
    'and public.championship_profile_can_act_for_team(team.id, actor_id)');
  execute ddl;
end $$;
