begin;

create or replace function public.reject_archived_championship_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'archived'::public.championship_status then
    raise exception 'Archived championship is read-only' using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.reject_archived_championship_match_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_division_id uuid;
  championship_state public.championship_status;
begin
  target_division_id := case
    when tg_op = 'DELETE' then old.division_id
    else new.division_id
  end;

  select championship.status
  into championship_state
  from public.championship_divisions as division
  join public.championships as championship
    on championship.id = division.championship_id
  where division.id = target_division_id;

  if championship_state = 'archived'::public.championship_status then
    raise exception 'Archived championship is read-only' using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.reject_archived_championship_standing_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_pool_id uuid;
  championship_state public.championship_status;
begin
  target_pool_id := case
    when tg_op = 'DELETE' then old.pool_id
    else new.pool_id
  end;

  select championship.status
  into championship_state
  from public.championship_pools as pool
  join public.championship_divisions as division
    on division.id = pool.division_id
  join public.championships as championship
    on championship.id = division.championship_id
  where pool.id = target_pool_id;

  if championship_state = 'archived'::public.championship_status then
    raise exception 'Archived championship is read-only' using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.reject_archived_championship_general_standing_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_division_id uuid;
  championship_state public.championship_status;
begin
  target_division_id := case
    when tg_op = 'DELETE' then old.division_id
    else new.division_id
  end;

  select championship.status
  into championship_state
  from public.championship_divisions as division
  join public.championships as championship
    on championship.id = division.championship_id
  where division.id = target_division_id;

  if championship_state = 'archived'::public.championship_status then
    raise exception 'Archived championship is read-only' using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.reject_archived_championship_update()
from public, anon, authenticated;
revoke all on function public.reject_archived_championship_match_mutation()
from public, anon, authenticated;
revoke all on function public.reject_archived_championship_standing_mutation()
from public, anon, authenticated;
revoke all on function public.reject_archived_championship_general_standing_mutation()
from public, anon, authenticated;

drop trigger if exists reject_archived_championship_update
on public.championships;
create trigger reject_archived_championship_update
before update or delete on public.championships
for each row execute function public.reject_archived_championship_update();

drop trigger if exists reject_archived_championship_match_mutation
on public.championship_matches;
create trigger reject_archived_championship_match_mutation
before insert or update or delete on public.championship_matches
for each row execute function public.reject_archived_championship_match_mutation();

drop trigger if exists reject_archived_championship_standing_mutation
on public.championship_standings;
create trigger reject_archived_championship_standing_mutation
before insert or update or delete on public.championship_standings
for each row execute function public.reject_archived_championship_standing_mutation();

drop trigger if exists reject_archived_championship_general_standing_mutation
on public.championship_general_standings;
create trigger reject_archived_championship_general_standing_mutation
before insert or update or delete on public.championship_general_standings
for each row execute function public.reject_archived_championship_general_standing_mutation();

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
