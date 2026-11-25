-- Emergency response: run on the BUSINESS database as a privileged operator.
-- Safe to run repeatedly. Does not delete clubs, users, or their data.
-- IMPORTANT: first disable PLATFORM_ADMIN_LEASES_ENABLED on the PLATFORM project.
-- Disabling issuance alone does NOT invalidate already issued leases.
begin;
do $$
begin
  if to_regclass('pilotoki_private.platform_admin_leases') is not null then
    update pilotoki_private.platform_admin_leases
       set revoked_at = now()
     where revoked_at is null;
  end if;
end
$$;
commit;

-- Verification (run separately after the transaction):
-- select count(*) as active_leases
-- from pilotoki_private.platform_admin_leases
-- where revoked_at is null and expires_at > now();
-- Expected result: 0.
