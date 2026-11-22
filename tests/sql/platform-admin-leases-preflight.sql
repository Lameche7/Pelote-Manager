-- Read-only checks on the BUSINESS database before and after rollout.
-- No tokens, personal data or secret values are returned.
select
  to_regclass('pilotoki_private.platform_admin_leases') is not null as lease_table_exists,
  to_regprocedure('public.issue_platform_admin_lease(uuid,uuid,integer)') is not null as issue_rpc_exists,
  to_regprocedure('public.revoke_platform_admin_lease(uuid)') is not null as revoke_rpc_exists,
  to_regprocedure('public.platform_admin_get_club_information(uuid)') is not null as read_rpc_exists,
  to_regprocedure('public.platform_admin_update_club_information(uuid,jsonb)') is not null as update_rpc_exists;

select
  p.proname as function_name,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'issue_platform_admin_lease',
    'revoke_platform_admin_lease',
    'platform_admin_get_club_information',
    'platform_admin_update_club_information'
  )
order by p.proname;

select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as row_security_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'pilotoki_private'
  and c.relname = 'platform_admin_leases';

-- Run only after the lease table has been created:
-- select count(*) as active_leases
-- from pilotoki_private.platform_admin_leases
-- where revoked_at is null and expires_at > now();

-- After migration: verify the lease is bound to one club and that no client
-- role can read the private lease table. Empty results before rollout are normal.
select
  a.attname as column_name,
  format_type(a.atttypid, a.atttypmod) as column_type,
  a.attnotnull as required
from pg_attribute a
where a.attrelid = to_regclass('pilotoki_private.platform_admin_leases')
  and a.attname in ('business_user_id', 'club_id', 'expires_at', 'revoked_at')
  and a.attnum > 0 and not a.attisdropped
order by a.attname;

select
  has_table_privilege('anon', to_regclass('pilotoki_private.platform_admin_leases'), 'SELECT') as anon_can_read,
  has_table_privilege('authenticated', to_regclass('pilotoki_private.platform_admin_leases'), 'SELECT') as authenticated_can_read
where to_regclass('pilotoki_private.platform_admin_leases') is not null;

-- Explicitly audit the private helper and schema privileges after rollout.
select
  has_schema_privilege('anon', 'pilotoki_private', 'USAGE') as anon_schema_usage,
  has_schema_privilege('authenticated', 'pilotoki_private', 'USAGE') as authenticated_schema_usage,
  has_schema_privilege('service_role', 'pilotoki_private', 'USAGE') as service_schema_usage
where to_regnamespace('pilotoki_private') is not null;

select
  p.proname as function_name,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'pilotoki_private'
  and p.proname = 'has_active_platform_lease';

-- No policy may expose the lease table to API users.
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'pilotoki_private' and tablename = 'platform_admin_leases';
