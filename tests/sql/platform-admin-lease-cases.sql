-- Every assertion runs against fictitious identities and is rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
do $$
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
end $$;
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001', 300);
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
begin
  if not public.has_club_permission('00000000-0000-0000-0000-000000000002', 'settings.manage') then
    raise exception 'Active platform lease did not authorize club B';
  end if;
  if (select count(*) from public.get_my_club_access()) <> 2 then
    raise exception 'Active lease must list both clubs';
  end if;
  if public.has_club_permission('00000000-0000-0000-0000-000000000002', 'invented.permission') then
    raise exception 'Unknown permission was accepted';
  end if;
end $$;
reset role;
-- Simulate an expired lease, without waiting five minutes.
update pilotoki_private.platform_admin_leases
set expires_at = now() - interval '1 second'
where business_user_id = '20000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$
begin
  if public.has_club_permission('00000000-0000-0000-0000-000000000002', 'settings.manage') then
    raise exception 'Expired lease still authorizes another club';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.issue_platform_admin_lease('20000000-0000-0000-0000-000000000001', 300);
select public.revoke_platform_admin_lease('20000000-0000-0000-0000-000000000001');
reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
do $$
begin
  if public.has_club_permission('00000000-0000-0000-0000-000000000002', 'settings.manage') then
    raise exception 'Revoked lease still authorizes another club';
  end if;
  if (select count(*) from public.get_my_club_access()) <> 1 then
    raise exception 'Revoked lease still lists another club';
  end if;
end $$;
rollback;
