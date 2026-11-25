-- Run only in an isolated database with the existing two-club fixture and tournament drafts installed.
-- No tournament is created by this test. All lease changes are rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  t uuid := '00000000-0000-0000-0000-000000000099';
begin
  begin
    perform public.platform_admin_get_tournament_options(c);
    raise exception 'Missing lease accepted: get_tournament_options';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_list_tournaments(c);
    raise exception 'Missing lease accepted: list_tournaments';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament(c, t);
    raise exception 'Missing lease accepted: get_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_create_tournament(c, '{}'::jsonb);
    raise exception 'Missing lease accepted: create_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_update_tournament(c, t, '{}'::jsonb);
    raise exception 'Missing lease accepted: update_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_save_tournament_configuration(c, t, '{}'::jsonb);
    raise exception 'Missing lease accepted: save_tournament_configuration';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_transition_tournament(c, t, 'configuration'::public.tournament_status);
    raise exception 'Missing lease accepted: transition_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_sporting_rules(c, t);
    raise exception 'Missing lease accepted: get_tournament_sporting_rules';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_save_tournament_sporting_rules(c, t, '{}'::jsonb);
    raise exception 'Missing lease accepted: save_tournament_sporting_rules';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_refereeing(c, t);
    raise exception 'Missing lease accepted: get_tournament_refereeing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_set_tournament_refereeing(c, t, true);
    raise exception 'Missing lease accepted: set_tournament_refereeing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_network_specialty(c, t);
    raise exception 'Missing lease accepted: get_tournament_network_specialty';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_set_tournament_network_specialty(c, t, 'Trinquet');
    raise exception 'Missing lease accepted: set_tournament_network_specialty';
  exception when insufficient_privilege then null;
  end;
end $check$;
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 300);
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  t uuid := '00000000-0000-0000-0000-000000000099';
begin
  begin
    perform public.platform_admin_get_tournament_options(c);
    raise exception 'Foreign club lease accepted: get_tournament_options';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_list_tournaments(c);
    raise exception 'Foreign club lease accepted: list_tournaments';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament(c, t);
    raise exception 'Foreign club lease accepted: get_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_create_tournament(c, '{}'::jsonb);
    raise exception 'Foreign club lease accepted: create_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_update_tournament(c, t, '{}'::jsonb);
    raise exception 'Foreign club lease accepted: update_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_save_tournament_configuration(c, t, '{}'::jsonb);
    raise exception 'Foreign club lease accepted: save_tournament_configuration';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_transition_tournament(c, t, 'configuration'::public.tournament_status);
    raise exception 'Foreign club lease accepted: transition_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_sporting_rules(c, t);
    raise exception 'Foreign club lease accepted: get_tournament_sporting_rules';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_save_tournament_sporting_rules(c, t, '{}'::jsonb);
    raise exception 'Foreign club lease accepted: save_tournament_sporting_rules';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_refereeing(c, t);
    raise exception 'Foreign club lease accepted: get_tournament_refereeing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_set_tournament_refereeing(c, t, true);
    raise exception 'Foreign club lease accepted: set_tournament_refereeing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_network_specialty(c, t);
    raise exception 'Foreign club lease accepted: get_tournament_network_specialty';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_set_tournament_network_specialty(c, t, 'Trinquet');
    raise exception 'Foreign club lease accepted: set_tournament_network_specialty';
  exception when insufficient_privilege then null;
  end;
end $check$;
reset role;
update pilotoki_private.platform_admin_leases set club_id = '00000000-0000-0000-0000-000000000002', expires_at = now() - interval '1 second' where business_user_id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  t uuid := '00000000-0000-0000-0000-000000000099';
begin
  begin
    perform public.platform_admin_get_tournament_options(c);
    raise exception 'Expired lease accepted: get_tournament_options';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_list_tournaments(c);
    raise exception 'Expired lease accepted: list_tournaments';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament(c, t);
    raise exception 'Expired lease accepted: get_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_create_tournament(c, '{}'::jsonb);
    raise exception 'Expired lease accepted: create_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_update_tournament(c, t, '{}'::jsonb);
    raise exception 'Expired lease accepted: update_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_save_tournament_configuration(c, t, '{}'::jsonb);
    raise exception 'Expired lease accepted: save_tournament_configuration';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_transition_tournament(c, t, 'configuration'::public.tournament_status);
    raise exception 'Expired lease accepted: transition_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_sporting_rules(c, t);
    raise exception 'Expired lease accepted: get_tournament_sporting_rules';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_save_tournament_sporting_rules(c, t, '{}'::jsonb);
    raise exception 'Expired lease accepted: save_tournament_sporting_rules';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_refereeing(c, t);
    raise exception 'Expired lease accepted: get_tournament_refereeing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_set_tournament_refereeing(c, t, true);
    raise exception 'Expired lease accepted: set_tournament_refereeing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_network_specialty(c, t);
    raise exception 'Expired lease accepted: get_tournament_network_specialty';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_set_tournament_network_specialty(c, t, 'Trinquet');
    raise exception 'Expired lease accepted: set_tournament_network_specialty';
  exception when insufficient_privilege then null;
  end;
end $check$;
reset role;
update pilotoki_private.platform_admin_leases set expires_at = now() + interval '1 minute', revoked_at = now() where business_user_id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
do $check$
declare
  c uuid := '00000000-0000-0000-0000-000000000002';
  t uuid := '00000000-0000-0000-0000-000000000099';
begin
  begin
    perform public.platform_admin_get_tournament_options(c);
    raise exception 'Revoked lease accepted: get_tournament_options';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_list_tournaments(c);
    raise exception 'Revoked lease accepted: list_tournaments';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament(c, t);
    raise exception 'Revoked lease accepted: get_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_create_tournament(c, '{}'::jsonb);
    raise exception 'Revoked lease accepted: create_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_update_tournament(c, t, '{}'::jsonb);
    raise exception 'Revoked lease accepted: update_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_save_tournament_configuration(c, t, '{}'::jsonb);
    raise exception 'Revoked lease accepted: save_tournament_configuration';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_transition_tournament(c, t, 'configuration'::public.tournament_status);
    raise exception 'Revoked lease accepted: transition_tournament';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_sporting_rules(c, t);
    raise exception 'Revoked lease accepted: get_tournament_sporting_rules';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_save_tournament_sporting_rules(c, t, '{}'::jsonb);
    raise exception 'Revoked lease accepted: save_tournament_sporting_rules';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_refereeing(c, t);
    raise exception 'Revoked lease accepted: get_tournament_refereeing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_set_tournament_refereeing(c, t, true);
    raise exception 'Revoked lease accepted: set_tournament_refereeing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_get_tournament_network_specialty(c, t);
    raise exception 'Revoked lease accepted: get_tournament_network_specialty';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_set_tournament_network_specialty(c, t, 'Trinquet');
    raise exception 'Revoked lease accepted: set_tournament_network_specialty';
  exception when insufficient_privilege then null;
  end;
end $check$;
rollback;
