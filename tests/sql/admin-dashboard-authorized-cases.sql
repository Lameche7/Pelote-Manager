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
rollback;
