-- Vérifie les lectures autorisées et l'absence de mélange des données.
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
do $check$
declare
  dashboard jsonb;
  counts jsonb;
  months jsonb;
begin
  dashboard := public.admin_get_dashboard('00000000-0000-0000-0000-000000000001');
  counts := public.admin_dashboard_match_counts('00000000-0000-0000-0000-000000000001');
  months := public.admin_monthly_match_report('00000000-0000-0000-0000-000000000001');
  if (dashboard #>> '{metrics,reservations_next_7_days}')::int <> 1 then
    raise exception 'Club A reservation count is contaminated';
  end if;
  if (counts ->> 'tournament_matches')::int <> 1 then
    raise exception 'Club A tournament count is contaminated';
  end if;
  if (select coalesce(sum((item ->> 'tournament_matches')::int), 0)
      from jsonb_array_elements(months) item) <> 1 then
    raise exception 'Club A monthly report is contaminated';
  end if;
  if dashboard::text like '%Terrain B%' then
    raise exception 'Club A dashboard exposes Club B resource';
  end if;
end $check$;

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
do $check$
declare
  dashboard jsonb;
  counts jsonb;
  months jsonb;
begin
  dashboard := public.admin_get_dashboard('00000000-0000-0000-0000-000000000002');
  counts := public.admin_dashboard_match_counts('00000000-0000-0000-0000-000000000002');
  months := public.admin_monthly_match_report('00000000-0000-0000-0000-000000000002');
  if (dashboard #>> '{metrics,reservations_next_7_days}')::int <> 2 then
    raise exception 'Club B reservation count is contaminated';
  end if;
  if (counts ->> 'tournament_matches')::int <> 2 then
    raise exception 'Club B tournament count is contaminated';
  end if;
  if (select coalesce(sum((item ->> 'tournament_matches')::int), 0)
      from jsonb_array_elements(months) item) <> 2 then
    raise exception 'Club B monthly report is contaminated';
  end if;
  if dashboard::text like '%Terrain A%' then
    raise exception 'Club B dashboard exposes Club A resource';
  end if;
end $check$;
-- Un bail temporaire autorise A à consulter B, sans mélanger les résultats.
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.issue_platform_admin_lease(
  '20000000-0000-0000-0000-000000000001',
  300
);
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
set local role authenticated;
do $check$
declare
  dashboard jsonb;
  counts jsonb;
  months jsonb;
begin
  dashboard := public.admin_get_dashboard('00000000-0000-0000-0000-000000000002');
  counts := public.admin_dashboard_match_counts('00000000-0000-0000-0000-000000000002');
  months := public.admin_monthly_match_report('00000000-0000-0000-0000-000000000002');
  if (dashboard #>> '{metrics,reservations_next_7_days}')::int <> 2 then
    raise exception 'Platform lease returned wrong club reservations';
  end if;
  if (counts ->> 'tournament_matches')::int <> 2 then
    raise exception 'Platform lease returned wrong club matches';
  end if;
  if (select coalesce(sum((item ->> 'tournament_matches')::int), 0)
      from jsonb_array_elements(months) item) <> 2 then
    raise exception 'Platform lease returned wrong monthly matches';
  end if;
  if dashboard::text like '%Terrain A%' then
    raise exception 'Platform lease exposed original club resources';
  end if;
end $check$;
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.revoke_platform_admin_lease(
  '20000000-0000-0000-0000-000000000001'
);
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $check$
declare
  function_name text;
begin
  foreach function_name in array array[
    'admin_get_dashboard',
    'admin_dashboard_match_counts',
    'admin_monthly_match_report'
  ] loop
    begin
      execute format('select public.%I($1)', function_name)
        using '00000000-0000-0000-0000-000000000002'::uuid;
      raise exception '% accepted a revoked platform lease', function_name;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $check$;
rollback;
