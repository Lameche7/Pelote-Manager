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
rollback;
