-- Draft: explicit club scope; no implicit administrative permission.
create or replace function public.platform_admin_get_club_modules(target_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id) then
    raise exception 'Club module access denied' using errcode = '42501';
  end if;
  return (select modules from pilotoki_private.club_module_profiles where club_id = target_club_id);
end;
$$;
revoke all on function public.platform_admin_get_club_modules(uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_get_club_modules(uuid) to authenticated;

create or replace function public.platform_admin_set_club_modules(target_club_id uuid, profile jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id) then
    raise exception 'Club module update denied' using errcode = '42501';
  end if;
  insert into pilotoki_private.club_module_profiles(club_id, modules)
  values (target_club_id, profile)
  on conflict (club_id) do update set modules = excluded.modules, updated_at = now();
  return profile;
end;
$$;
revoke all on function public.platform_admin_set_club_modules(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.platform_admin_set_club_modules(uuid,jsonb) to authenticated;
