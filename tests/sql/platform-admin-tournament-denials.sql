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
rollback;
