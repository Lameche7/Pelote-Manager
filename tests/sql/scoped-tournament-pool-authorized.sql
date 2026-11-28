-- Ephemeral CI only; grants and fixture data are rolled back.
begin;
select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',300);
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  t uuid;
  s uuid;
  team uuid;
  foreign_tournament uuid;
  foreign_series uuid;
  foreign_team uuid;
  teams jsonb := '[]'::jsonb;
  payload jsonb;
  workspace jsonb;
  i integer;
begin
  t := public.platform_admin_create_tournament(c,jsonb_build_object(
    'season_id','70000000-0000-0000-0000-000000000002','name','CI pools',
    'pool_starts_on','2027-02-01','pool_ends_on','2027-02-28',
    'finals_starts_on','2027-03-01','finals_ends_on','2027-03-07',
    'registration_opens_at',now()+interval '1 day','registration_closes_at',now()+interval '2 days',
    'registration_fee_cents',1500));
  perform public.platform_admin_save_tournament_configuration(c,t,jsonb_build_object(
    'resource_ids',jsonb_build_array('71000000-0000-0000-0000-000000000002'),
    'series',jsonb_build_array(jsonb_build_object('name','CI series','capacity',8,'enabled',true)),
    'play_windows',jsonb_build_array(jsonb_build_object('weekday',1,'opens_at','18:00','closes_at','20:00'))));
  s := (public.platform_admin_get_tournament(c,t)->'series'->0->>'id')::uuid;

  insert into public.tournaments(club_id,season_id,name,status,starts_on,ends_on,pool_starts_on,pool_ends_on,finals_starts_on,finals_ends_on,registration_opens_at,registration_closes_at)
  values ('00000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','CI foreign pools','preparation','2027-02-01','2027-03-07','2027-02-01','2027-02-28','2027-03-01','2027-03-07',now()+interval '1 day',now()+interval '2 days')
  returning id into foreign_tournament;
  insert into public.tournament_series(tournament_id,name,capacity,display_order,enabled)
  values(foreign_tournament,'CI shared series',8,0,true) returning id into foreign_series;
  insert into public.tournament_teams(tournament_id,series_id,status,contact_email)
  values(foreign_tournament,foreign_series,'accepted','player-b@test.local') returning id into foreign_team;

  -- A signed-in user without the club permission or a lease must be denied.
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000004',true);
  begin
    perform public.admin_get_tournament_pool_workspace_v2_for_club(c,t);
    raise exception 'Unauthorized workspace read' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_save_tournament_pools_for_club(c,t,'{}'::jsonb);
    raise exception 'Unauthorized pool save' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_validate_tournament_pools_for_club(c,t);
    raise exception 'Unauthorized pool validation' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_reopen_tournament_pools_for_club(c,t);
    raise exception 'Unauthorized pool reopening' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000001',true);
  update public.tournaments set status='registrations_closed' where id=t;
  for i in 1..3 loop
    insert into public.tournament_teams(tournament_id,series_id,status,contact_email)
      values(t,s,'accepted','pool-'||i||'@example.test') returning id into team;
    insert into public.tournament_team_players(team_id,tournament_id,role,first_name,last_name,email,display_order,club_name)
      values(team,t,'front','Fixture','Player '||i,'pool-'||i||'@example.test',0,'Club B');
    teams := teams || jsonb_build_array(jsonb_build_object('team_id',team,'display_order',i-1));
  end loop;
  payload := jsonb_build_object('pools',jsonb_build_array(jsonb_build_object('series_id',s,'display_order',0,'target_size',3,'teams',teams)));
  workspace := public.admin_get_tournament_pool_workspace_v2_for_club(c,t);
  if jsonb_array_length(workspace->'teams')<>3 or jsonb_array_length(workspace->'pairings')<>3
    or workspace->'teams'->0->'players'->0->>'club_name' is distinct from 'Club B' then
    raise exception 'Unexpected pool workspace: %',workspace;
  end if;
  begin
    perform public.admin_get_tournament_pool_workspace_v2_for_club(c,foreign_tournament);
    raise exception 'Foreign workspace exposed' using errcode='XX000';
  exception when no_data_found then null; end;
  begin
    perform public.admin_save_tournament_pools_for_club(c,foreign_tournament,payload);
    raise exception 'Foreign tournament save accepted' using errcode='XX000';
  exception when no_data_found then null; end;
  begin
    perform public.admin_validate_tournament_pools_for_club(c,foreign_tournament);
    raise exception 'Foreign validation accepted' using errcode='XX000';
  exception when no_data_found then null; end;
  begin
    perform public.admin_reopen_tournament_pools_for_club(c,foreign_tournament);
    raise exception 'Foreign reopening accepted' using errcode='XX000';
  exception when no_data_found then null; end;
  begin
    perform public.admin_save_tournament_pools_for_club(c,t,jsonb_set(payload,'{pools,0,teams,0,team_id}',to_jsonb(foreign_team)));
    raise exception 'Foreign team accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_save_tournament_pools_for_club(c,t,jsonb_set(payload,'{pools,0,teams,1,team_id}',teams->0->'team_id'));
    raise exception 'Duplicate team accepted' using errcode='XX000';
  exception when invalid_parameter_value then null; end;
  perform public.admin_save_tournament_pools_for_club(c,t,payload);
  workspace := public.admin_get_tournament_pool_workspace_v2_for_club(c,t);
  if workspace->'tournament'->>'status' is distinct from 'pools_generated'
    or jsonb_array_length(workspace->'pools'->0->'teams')<>3 then
    raise exception 'Three-team pool not saved: %',workspace;
  end if;
  perform public.admin_validate_tournament_pools_for_club(c,t);
  if (select status from public.tournaments where id=t) <> 'pools_validated' then
    raise exception 'Pool not validated';
  end if;
  perform public.admin_reopen_tournament_pools_for_club(c,t);
  if (select status from public.tournaments where id=t) <> 'pools_generated' then
    raise exception 'Pool not reopened';
  end if;
  if exists(select 1 from public.tournament_pools where tournament_id=foreign_tournament) then
    raise exception 'Foreign tournament changed';
  end if;
end $check$;
rollback;
