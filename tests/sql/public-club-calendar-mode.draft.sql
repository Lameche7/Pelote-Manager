-- Public navigation: expose a derived mode, not the private profile.
create or replace function public.get_public_club_calendar_mode(target_slug text default null)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((select case
    when coalesce((p.modules->>'reservations')::boolean, true) then 'reservations'
    when coalesce((p.modules->>'tournaments')::boolean, true)
      and coalesce((p.modules->>'tournamentPlanning')::boolean, true) then 'planning'
    else 'disabled'
  end
  from public.clubs c
  left join pilotoki_private.club_module_profiles p on p.club_id = c.id
  where nullif(btrim(target_slug), '') is null
    or c.slug = nullif(btrim(target_slug), '')
  order by c.created_at
  limit 1), 'disabled')
$function$;
revoke all on function public.get_public_club_calendar_mode(text) from public, anon, authenticated;
grant execute on function public.get_public_club_calendar_mode(text) to anon, authenticated;
