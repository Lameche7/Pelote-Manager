-- Resolve an existing ordinary booking at the exact calendar interval for authorized club admins.
create or replace function public.admin_calendar_reservation_for_conversion(
  target_resource_id uuid, target_starts_at timestamptz, target_ends_at timestamptz
) returns uuid language plpgsql stable security definer set search_path='' as $$
declare target_club uuid; found_id uuid; booking_count integer;
begin
  select club_id into target_club from public.reservable_resources where id=target_resource_id;
  if auth.uid() is null or target_club is null
     or not public.has_club_permission(target_club,'reservations.manage')
     or not public.has_club_permission(target_club,'championships.manage') then
    raise exception 'Accès refusé' using errcode='42501';
  end if;
  select count(*),(array_agg(id))[1] into booking_count,found_id
  from public.reservations
  where resource_id=target_resource_id
    and starts_at=target_starts_at and ends_at=target_ends_at
    and status in ('pending','confirmed') and championship_match_id is null;
  if booking_count<>1 then
    raise exception 'Aucune réservation ordinaire unique sur ce créneau' using errcode='22023';
  end if;
  return found_id;
end $$;
revoke all on function public.admin_calendar_reservation_for_conversion(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.admin_calendar_reservation_for_conversion(uuid,timestamptz,timestamptz) to authenticated;
