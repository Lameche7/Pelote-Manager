-- Expose the most recent final-fixture synchronization audit for one championship
-- to its authorized club administrators; never expose other clubs' logs.
create or replace function public.admin_get_final_fixtures_sync_report(target_championship_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  current_club uuid := public.admin_current_club_id();
  result jsonb;
begin
  if auth.uid() is null or current_club is null or
    not public.championship_club_can_manage(target_championship_id,current_club)
  then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  select jsonb_build_object(
    'completedAt', audit.created_at,
    'added', coalesce((audit.payload->>'finalMatchesCreated')::int,0),
    'alreadyPresent', coalesce((audit.payload->>'finalMatchesAlreadyPresent')::int,0),
    'byDivision', coalesce(audit.payload->'finalMatchesAddedByDivision','{}'::jsonb),
    'warnings', coalesce(audit.payload->'warnings','[]'::jsonb)
  ) into result
  from public.championship_audit_log audit
  where audit.championship_id=target_championship_id
    and audit.action='championship.final_fixtures_sync'
  order by audit.created_at desc,audit.id desc limit 1;
  return result;
end $$;
revoke all on function public.admin_get_final_fixtures_sync_report(uuid) from public,anon;
grant execute on function public.admin_get_final_fixtures_sync_report(uuid) to authenticated;
