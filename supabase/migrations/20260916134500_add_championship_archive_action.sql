begin;

create or replace function public.admin_archive_championship(
  target_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  previous_status public.championship_status;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.championship_club_can_manage(target_id, target_club_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select championship.status
  into previous_status
  from public.championships as championship
  where championship.id = target_id
  for update;

  if previous_status is null then
    raise exception 'Championship not found' using errcode = 'P0002';
  end if;

  if previous_status = 'archived'::public.championship_status then
    return jsonb_build_object(
      'championshipId', target_id,
      'status', 'archived',
      'alreadyArchived', true
    );
  end if;

  update public.championships
  set
    status = 'archived'::public.championship_status,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id;

  insert into public.championship_audit_log (
    championship_id,
    club_id,
    actor_id,
    action,
    payload
  ) values (
    target_id,
    target_club_id,
    auth.uid(),
    'championship_archived',
    jsonb_build_object(
      'previousStatus', previous_status,
      'newStatus', 'archived'
    )
  );

  return jsonb_build_object(
    'championshipId', target_id,
    'status', 'archived',
    'alreadyArchived', false
  );
end;
$$;

revoke all on function public.admin_archive_championship(uuid)
from public, anon, authenticated;
grant execute on function public.admin_archive_championship(uuid)
to authenticated;

commit;
