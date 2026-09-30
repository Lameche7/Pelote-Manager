begin;

create or replace function public.is_active_licensee(
  target_profile_id uuid,
  target_date date default current_date
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
begin
  select min(club_id)
  into target_club_id
  from public.club_reservation_settings
  having count(*) = 1;

  if target_club_id is null then
    raise exception 'Club selection required'
      using errcode = '22023';
  end if;

  return public.is_active_licensee_for_club(
    target_profile_id,
    target_club_id,
    target_date
  );
end;
$$;

drop table public.reservation_settings;

commit;
