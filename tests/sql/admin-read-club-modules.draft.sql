-- Read-only access for an administrator of the explicitly requested club.
-- Missing profile means legacy full configuration, not a permission grant.
create or replace function public.admin_get_club_modules(target_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or target_club_id is null
     or not coalesce(public.has_club_permission(target_club_id, 'admin.dashboard.read'), false) then
    raise exception 'Club module access denied' using errcode = '42501';
  end if;
  return (select modules from pilotoki_private.club_module_profiles where club_id = target_club_id);
end;
$$;
revoke all on function public.admin_get_club_modules(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_club_modules(uuid) to authenticated;
