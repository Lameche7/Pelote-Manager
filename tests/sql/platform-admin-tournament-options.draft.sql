-- Explicit club read for tournament setup; never changes legacy permissions.
create or replace function public.platform_admin_get_tournament_options(target_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or target_club_id is null
     or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(), target_club_id), false) then
    raise exception 'Tournament options access denied' using errcode = '42501';
  end if;
  if not coalesce((select (modules->>'tournaments')::boolean
    from pilotoki_private.club_module_profiles where club_id = target_club_id), true) then
    raise exception 'Tournament module disabled' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'seasons', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'starts_on', s.starts_on,
      'ends_on', s.ends_on, 'is_active', s.is_active
    ) order by s.starts_on desc), '[]'::jsonb)
      from public.club_seasons s where s.club_id = target_club_id),
    'resources', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name
    ) order by r.name), '[]'::jsonb)
      from public.reservable_resources r where r.club_id = target_club_id and r.is_active)
  );
end;
$$;
revoke all on function public.platform_admin_get_tournament_options(uuid) from public, anon, authenticated;
grant execute on function public.platform_admin_get_tournament_options(uuid) to authenticated;
