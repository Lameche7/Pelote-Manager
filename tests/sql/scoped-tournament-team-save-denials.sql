-- Ephemeral CI database only. No real data or production credentials.
begin;

do $check$
declare
  fn record;
  function_count integer := 0;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_save_tournament_team_for_club',
        'admin_save_tournament_team_v2_for_club',
        'admin_save_tournament_team_v3_for_club',
        'admin_save_tournament_team_v4_for_club',
        'admin_save_tournament_team_v5_for_club'
      )
  loop
    function_count := function_count + 1;
    if has_function_privilege('anon', fn.oid, 'EXECUTE')
      or has_function_privilege('authenticated', fn.oid, 'EXECUTE')
        is distinct from (fn.proname = 'admin_save_tournament_team_v5_for_club') then
      raise exception 'Unexpected execution privilege: %', fn.proname;
    end if;
  end loop;
  if function_count <> 5 then
    raise exception 'Expected five scoped save functions';
  end if;
end $check$;

-- Exercise the public entry point with a synthetic actor, no lease.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
do $check$
begin
  begin
    perform public.admin_save_tournament_team_v5_for_club(
      '00000000-0000-0000-0000-000000000002', null, null, '{}'::jsonb);
    raise exception 'Unauthorized club accepted';
  exception when insufficient_privilege then null;
  end;
end $check$;
reset role;

-- A legitimate lease for A must not grant access to B.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.issue_platform_admin_lease(
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001', 300);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
do $check$
begin
  begin
    perform public.admin_save_tournament_team_v5_for_club(
      '00000000-0000-0000-0000-000000000002', null, null, '{}'::jsonb);
    raise exception 'Foreign club lease accepted';
  exception when insufficient_privilege then null;
  end;
end $check$;
reset role;

-- Expired and revoked lease cases use only the synthetic CI record.
update pilotoki_private.platform_admin_leases
set club_id = '00000000-0000-0000-0000-000000000002',
    expires_at = now() - interval '1 second'
where business_user_id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
do $check$
begin
  begin
    perform public.admin_save_tournament_team_v5_for_club(
      '00000000-0000-0000-0000-000000000002', null, null, '{}'::jsonb);
    raise exception 'Expired lease accepted';
  exception when insufficient_privilege then null;
  end;
end $check$;
reset role;
update pilotoki_private.platform_admin_leases
set expires_at = now() + interval '1 minute', revoked_at = now()
where business_user_id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
do $check$
begin
  begin
    perform public.admin_save_tournament_team_v5_for_club(
      '00000000-0000-0000-0000-000000000002', null, null, '{}'::jsonb);
    raise exception 'Revoked lease accepted';
  exception when insufficient_privilege then null;
  end;
end $check$;
reset role;
rollback;
