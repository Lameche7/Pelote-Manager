begin;

create or replace function public.admin_list_permanent_slot_candidates()
returns table (
  profile_id uuid,
  display_name text,
  email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
begin
  if not public.has_club_permission(target_club_id, 'reservations.manage') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
      profile.email
    ) as display_name,
    profile.email
  from public.profiles as profile
  order by
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
      profile.email
    ),
    profile.email;
end;
$$;

revoke all on function public.admin_list_permanent_slot_candidates()
from public, anon, authenticated;
grant execute on function public.admin_list_permanent_slot_candidates()
to authenticated;

create or replace function public.has_my_permanent_slots()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.permanent_slot_managers as manager
    join public.permanent_slots as slot
      on slot.id = manager.permanent_slot_id
    where manager.profile_id = auth.uid()
      and slot.is_active
      and slot.valid_until >= current_date
  );
$$;

revoke all on function public.has_my_permanent_slots()
from public, anon, authenticated;
grant execute on function public.has_my_permanent_slots()
to authenticated;

commit;
