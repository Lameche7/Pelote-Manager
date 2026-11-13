-- Every assertion runs against fictitious identities and is rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
do $check$
begin
  if public.has_club_permission('00000000-0000-0000-0000-000000000002', 'settings.manage') then
    raise exception 'Club A administrator unexpectedly manages B';
  end if;
  if not public.has_club_permission('00000000-0000-0000-0000-000000000001', 'settings.manage') then
    raise exception 'Club A administrator lost own permissions';
  end if;
  if (select count(*) from public.get_my_club_access()) <> 1 then
    raise exception 'Ordinary administrator can see other clubs';
  end if;
  begin
    perform public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001', 300);
    raise exception 'Authenticated user issued own lease';
  exception when insufficient_privilege then null;
  end;
end $check$;
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001', 300);
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $check$
begin
  if not public.can_read_scoped_club_dashboard('00000000-0000-0000-0000-000000000002') then
    raise exception 'Active platform lease did not authorize read-only dashboard for B';
  end if;
  if (public.platform_admin_get_club_information('00000000-0000-0000-0000-000000000002')->>'id')
     is distinct from '00000000-0000-0000-0000-000000000002' then
    raise exception 'Scoped club information read returned wrong club';
  end if;
  begin
    perform public.platform_admin_update_club_information(
      '00000000-0000-0000-0000-000000000002',
      '{"id":"00000000-0000-0000-0000-000000000001"}'::jsonb
    );
    raise exception 'Scoped club information update accepted immutable id';
  exception when invalid_parameter_value then null;
  end;
  if (public.platform_admin_update_club_information(
    '00000000-0000-0000-0000-000000000002',
    '{"notes":"Mise à jour testée"}'::jsonb
  )->>'id') is distinct from '00000000-0000-0000-0000-000000000002' then
    raise exception 'Scoped club information update returned wrong club';
  end if;
  if (public.platform_admin_get_club_information(
      '00000000-0000-0000-0000-000000000002'
    )->>'notes') is distinct from 'Mise à jour testée' then
    raise exception 'Scoped club information update did not persist';
  end if;
  if (public.platform_admin_get_club_information(
      '00000000-0000-0000-0000-000000000001'
    )->>'notes') is not null then
    raise exception 'Scoped update modified another club';
  end if;
  if public.has_club_permission('00000000-0000-0000-0000-000000000002', 'settings.manage') then
    raise exception 'Active platform lease granted cross-club write access';
  end if;
  if (select count(*) from public.get_my_club_access()) <> 1 then
    raise exception 'Active lease must not change legacy club listing';
  end if;
  if public.has_club_permission('00000000-0000-0000-0000-000000000002', 'invented.permission') then
    raise exception 'Unknown permission was accepted';
  end if;
end $check$;
-- Another authenticated user must not inherit the lease.
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
do $check$
begin
  if public.has_club_permission('00000000-0000-0000-0000-000000000001', 'settings.manage') then
    raise exception 'Another club administrator inherited the lease';
  end if;
  if (select count(*) from public.get_my_club_access()) <> 1 then
    raise exception 'Another club administrator sees both clubs';
  end if;
end $check$;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
reset role;
-- A service may not issue leases longer than the server-side maximum.
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
do $check$
begin
  begin
    perform public.issue_platform_admin_lease(
      '20000000-0000-0000-0000-000000000001',
      901
    );
    raise exception 'Lease longer than 15 minutes was accepted';
  exception when invalid_parameter_value then null;
  end;
end $check$;
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
reset role;
-- Simulate an expired lease, without waiting five minutes.
update pilotoki_private.platform_admin_leases
set expires_at = now() - interval '1 second'
where business_user_id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
do $check$
begin
  if public.can_read_scoped_club_dashboard('00000000-0000-0000-0000-000000000002') then
    raise exception 'Expired lease still authorizes another club';
  end if;
  begin
    perform public.platform_admin_get_club_information('00000000-0000-0000-0000-000000000002');
    raise exception 'Expired lease allowed club information read';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_update_club_information(
      '00000000-0000-0000-0000-000000000002',
      '{"notes":"should be refused"}'::jsonb
    );
    raise exception 'Expired lease allowed club information update';
  exception when insufficient_privilege then null;
  end;
end $check$;
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001', 300);
select public.revoke_platform_admin_lease('20000000-0000-0000-0000-000000000001');
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $check$
begin
  if public.can_read_scoped_club_dashboard('00000000-0000-0000-0000-000000000002') then
    raise exception 'Revoked lease still authorizes another club';
  end if;
  if (select count(*) from public.get_my_club_access()) <> 1 then
    raise exception 'Revoked lease still lists another club';
  end if;
  begin
    perform public.platform_admin_get_club_information(
      '00000000-0000-0000-0000-000000000002'
    );
    raise exception 'Revoked lease allowed information read';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.platform_admin_update_club_information(
      '00000000-0000-0000-0000-000000000002',
      '{"notes":"revoked write"}'::jsonb
    );
    raise exception 'Revoked lease allowed information update';
  exception when insufficient_privilege then null;
  end;
end $check$;
rollback;
