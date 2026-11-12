-- PostgreSQL éphémère uniquement : vérifie le refus avant toute lecture métier.
-- Les tables métier complètes ne figurent pas dans cette fixture minimale.
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);

do $check$
declare
  function_name text;
  target uuid;
begin
  foreach function_name in array array[
    'admin_get_dashboard',
    'admin_dashboard_match_counts',
    'admin_monthly_match_report'
  ] loop
    foreach target in array array[
      '00000000-0000-0000-0000-000000000002'::uuid,
      null::uuid
    ] loop
      begin
        execute format('select public.%I($1)', function_name) using target;
        raise exception '% accepted unauthorized or null club', function_name;
      exception when insufficient_privilege then
        null;
      end;
    end loop;
  end loop;
end $check$;
-- Administrateur B : les fonctions doivent également refuser le club A.
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
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
        using '00000000-0000-0000-0000-000000000001'::uuid;
      raise exception '% allowed administrator B to read A', function_name;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $check$;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);

-- Un club inexistant ne doit jamais être accepté.
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
        using '00000000-0000-0000-0000-000000000099'::uuid;
      raise exception '% accepted unknown club', function_name;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $check$;
-- Même avec un bail plateforme expiré ou révoqué, les RPC doivent refuser B.
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.issue_platform_admin_lease(
  '20000000-0000-0000-0000-000000000001',
  300
);
reset role;
update pilotoki_private.platform_admin_leases
set expires_at = now() - interval '1 second'
where business_user_id = '20000000-0000-0000-0000-000000000001';
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
      raise exception '% accepted expired lease', function_name;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $check$;
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.issue_platform_admin_lease(
  '20000000-0000-0000-0000-000000000001',
  300
);
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
      raise exception '% accepted revoked lease', function_name;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $check$;
rollback;
