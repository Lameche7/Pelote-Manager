-- Ephemeral PostgreSQL only. All fictitious records are rolled back.
begin;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 300);
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  s uuid := '70000000-0000-0000-0000-000000000002';
  r uuid := '71000000-0000-0000-0000-000000000002';
  t uuid;
  opts jsonb;
  draft jsonb;
  cfg jsonb;
  detail jsonb;
begin
  opts := public.platform_admin_get_tournament_options(c);
  if jsonb_array_length(opts->'seasons') <> 1 or opts->'seasons'->0->>'id' is distinct from s::text
    or jsonb_array_length(opts->'resources') <> 1 or opts->'resources'->0->>'id' is distinct from r::text then
    raise exception 'Incorrect club options';
  end if;
  draft := jsonb_build_object('season_id',s,'name','CI fictitious tournament',
    'pool_starts_on','2027-02-01','pool_ends_on','2027-02-28',
    'finals_starts_on','2027-03-01','finals_ends_on','2027-03-07',
    'registration_opens_at',now()+interval '1 day',
    'registration_closes_at',now()+interval '2 days','registration_fee_cents',1500);
  begin
    perform public.platform_admin_create_tournament(c,draft || '{"season_id":"70000000-0000-0000-0000-000000000001"}'::jsonb);
    raise exception 'Foreign season accepted';
  exception when invalid_parameter_value then null;
  end;
  t := public.platform_admin_create_tournament(c,draft);
  detail := public.platform_admin_get_tournament(c,t);
  if detail->>'id' is distinct from t::text or detail->>'registration_fee_cents' is distinct from '1500' then
    raise exception 'Created tournament details incorrect';
  end if;
  if jsonb_array_length(public.platform_admin_list_tournaments(c)) <> 1 then
    raise exception 'Unexpected tournament list';
  end if;
  perform public.platform_admin_update_tournament(c,t,draft || '{"name":"CI renamed tournament"}'::jsonb);
  cfg := jsonb_build_object('resource_ids',jsonb_build_array(r),
    'series',jsonb_build_array(jsonb_build_object('name','CI series','capacity',8,'enabled',true)),
    'play_windows',jsonb_build_array(jsonb_build_object('weekday',1,'opens_at','18:00','closes_at','20:00')));
  begin
    perform public.platform_admin_save_tournament_configuration(c,t,cfg || '{"resource_ids":["71000000-0000-0000-0000-000000000001"]}'::jsonb);
    raise exception 'Foreign resource accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.platform_admin_save_tournament_configuration(c,t,cfg);
  perform public.platform_admin_save_tournament_sporting_rules(c,t,'{"single_game_points":40}'::jsonb);
  if public.platform_admin_get_tournament_sporting_rules(c,t)->>'single_game_points' is distinct from '40' then
    raise exception 'Sporting rules not saved';
  end if;
  perform public.platform_admin_set_tournament_refereeing(c,t,true);
  if public.platform_admin_get_tournament_refereeing(c,t) is distinct from true then
    raise exception 'Refereeing not enabled';
  end if;
  perform public.platform_admin_set_tournament_network_specialty(c,t,'Trinquet');
  if public.platform_admin_get_tournament_network_specialty(c,t) is distinct from 'Trinquet' then
    raise exception 'Network specialty not saved';
  end if;
  perform public.platform_admin_transition_tournament(c,t,'configuration');
  detail := public.platform_admin_get_tournament(c,t);
  if detail->>'status' is distinct from 'configuration' or detail->>'name' is distinct from 'CI renamed tournament' then
    raise exception 'Tournament configuration not saved';
  end if;
  if jsonb_array_length(detail->'resources') <> 1 or detail->'resources'->0->>'id' is distinct from r::text
    or jsonb_array_length(detail->'series') <> 1 or jsonb_array_length(detail->'play_windows') <> 1 then
    raise exception 'Tournament configuration details incorrect';
  end if;
  begin
    perform public.platform_admin_transition_tournament(c,t,'registrations_open');
    raise exception 'Premature opening accepted' using errcode='XX000';
  exception when raise_exception then null;
  end;
end $check$;
rollback;
