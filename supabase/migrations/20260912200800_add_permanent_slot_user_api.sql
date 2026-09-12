begin;

create or replace function public.list_my_permanent_slot_occurrences(
  target_from date default current_date,
  target_to date default current_date + 21
)
returns table (
  occurrence_id uuid,
  permanent_slot_id uuid,
  label text,
  resource_id uuid,
  resource_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  management_opens_at timestamptz,
  can_manage_now boolean,
  is_rebooked boolean,
  is_primary boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    occurrence.id,
    slot.id,
    slot.label,
    resource.id,
    resource.name,
    occupation.starts_at,
    occupation.ends_at,
    occurrence.status::text,
    occupation.starts_at - make_interval(hours => slot.management_window_hours),
    now() >= occupation.starts_at - make_interval(hours => slot.management_window_hours)
      and now() < occupation.starts_at
      and occurrence.status <> 'cancelled'::public.permanent_slot_occurrence_status
      and not exists (
        select 1
        from public.calendar_occupations as other_occupation
        where other_occupation.resource_id = slot.resource_id
          and other_occupation.id <> occurrence.occupation_id
          and other_occupation.cancelled_at is null
          and tstzrange(other_occupation.starts_at, other_occupation.ends_at, '[)')
            && tstzrange(occupation.starts_at, occupation.ends_at, '[)')
      ) as can_manage_now,
    occurrence.status = 'released'::public.permanent_slot_occurrence_status
      and exists (
        select 1
        from public.calendar_occupations as other_occupation
        where other_occupation.resource_id = slot.resource_id
          and other_occupation.id <> occurrence.occupation_id
          and other_occupation.cancelled_at is null
          and tstzrange(other_occupation.starts_at, other_occupation.ends_at, '[)')
            && tstzrange(occupation.starts_at, occupation.ends_at, '[)')
      ) as is_rebooked,
    manager.is_primary
  from public.permanent_slot_managers as manager
  join public.permanent_slots as slot
    on slot.id = manager.permanent_slot_id
   and slot.is_active
  join public.permanent_slot_occurrences as occurrence
    on occurrence.permanent_slot_id = slot.id
  join public.calendar_occupations as occupation
    on occupation.id = occurrence.occupation_id
  join public.reservable_resources as resource
    on resource.id = slot.resource_id
  where manager.profile_id = auth.uid()
    and occurrence.occurrence_date between target_from and target_to
    and occurrence.status <> 'cancelled'::public.permanent_slot_occurrence_status
  order by occupation.starts_at;
$$;

revoke all on function public.list_my_permanent_slot_occurrences(date, date)
from public, anon, authenticated;
grant execute on function public.list_my_permanent_slot_occurrences(date, date)
to authenticated;

create or replace function public.set_my_permanent_slot_occurrence_status(
  target_occurrence_id uuid,
  target_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_slot_id uuid;
  target_occupation_id uuid;
  current_status public.permanent_slot_occurrence_status;
  target_starts_at timestamptz;
  target_ends_at timestamptz;
  target_resource_id uuid;
  management_window_hours integer;
  next_status public.permanent_slot_occurrence_status;
begin
  if target_status not in ('scheduled', 'confirmed', 'released') then
    raise exception 'Action invalide' using errcode = '22023';
  end if;

  next_status := target_status::public.permanent_slot_occurrence_status;

  select
    slot.id,
    occurrence.occupation_id,
    occurrence.status,
    occupation.starts_at,
    occupation.ends_at,
    slot.resource_id,
    slot.management_window_hours
  into
    target_slot_id,
    target_occupation_id,
    current_status,
    target_starts_at,
    target_ends_at,
    target_resource_id,
    management_window_hours
  from public.permanent_slot_occurrences as occurrence
  join public.permanent_slots as slot
    on slot.id = occurrence.permanent_slot_id
   and slot.is_active
  join public.permanent_slot_managers as manager
    on manager.permanent_slot_id = slot.id
   and manager.profile_id = auth.uid()
  join public.calendar_occupations as occupation
    on occupation.id = occurrence.occupation_id
  where occurrence.id = target_occurrence_id;

  if target_slot_id is null then
    raise exception 'Créneau permanent introuvable ou non autorisé'
      using errcode = '42501';
  end if;

  if current_status = 'cancelled'::public.permanent_slot_occurrence_status then
    raise exception 'Ce créneau permanent est annulé' using errcode = 'P0001';
  end if;

  if now() < target_starts_at - make_interval(hours => management_window_hours) then
    raise exception 'La gestion de ce créneau ouvrira % h avant son début',
      management_window_hours using errcode = 'P0001';
  end if;

  if now() >= target_starts_at then
    raise exception 'Ce créneau a déjà commencé' using errcode = 'P0001';
  end if;

  if next_status = 'released'::public.permanent_slot_occurrence_status then
    update public.calendar_occupations
    set cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now(),
        updated_by = auth.uid()
    where id = target_occupation_id;

    update public.permanent_slot_occurrences
    set status = 'released',
        released_at = now(),
        released_by = auth.uid(),
        updated_at = now()
    where id = target_occurrence_id;
  else
    if current_status = 'released'::public.permanent_slot_occurrence_status then
      if exists (
        select 1
        from public.calendar_occupations as other_occupation
        where other_occupation.resource_id = target_resource_id
          and other_occupation.id <> target_occupation_id
          and other_occupation.cancelled_at is null
          and tstzrange(other_occupation.starts_at, other_occupation.ends_at, '[)')
            && tstzrange(target_starts_at, target_ends_at, '[)')
      ) then
        raise exception 'Ce créneau a déjà été repris par un autre utilisateur'
          using errcode = '23P01';
      end if;

      begin
        update public.calendar_occupations
        set cancelled_at = null,
            updated_at = now(),
            updated_by = auth.uid()
        where id = target_occupation_id;
      exception
        when exclusion_violation then
          raise exception 'Ce créneau a déjà été repris par un autre utilisateur'
            using errcode = '23P01';
      end;
    end if;

    update public.permanent_slot_occurrences
    set status = next_status,
        confirmed_at = case
          when next_status = 'confirmed' then now()
          else null
        end,
        confirmed_by = case
          when next_status = 'confirmed' then auth.uid()
          else null
        end,
        released_at = null,
        released_by = null,
        updated_at = now()
    where id = target_occurrence_id;
  end if;

  insert into public.permanent_slot_audit_log (
    permanent_slot_id,
    occurrence_id,
    action,
    actor_id,
    previous_status,
    new_status
  ) values (
    target_slot_id,
    target_occurrence_id,
    'occurrence_status_changed',
    auth.uid(),
    current_status,
    next_status
  );
end;
$$;

revoke all on function public.set_my_permanent_slot_occurrence_status(uuid, text)
from public, anon, authenticated;
grant execute on function public.set_my_permanent_slot_occurrence_status(uuid, text)
to authenticated;

commit;
