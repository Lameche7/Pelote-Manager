-- Le calendrier public ne doit lister que les terrains du club affiché.
-- Sans slug, conserver le même club par défaut que get_public_club_branding().
create or replace function public.list_public_calendar_resources(
  target_slug text default null
)
returns table (
  id uuid,
  club_id uuid,
  name text,
  description text,
  timezone text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select resource.id, resource.club_id, resource.name,
         resource.description, resource.timezone
  from public.reservable_resources as resource
  where resource.is_active = true
    and resource.club_id = (
      select club.id
      from public.clubs as club
      where (
        nullif(btrim(target_slug), '') is not null
        and club.slug = nullif(btrim(target_slug), '')
      ) or (
        nullif(btrim(target_slug), '') is null
      )
      order by club.created_at
      limit 1
    )
  order by resource.name;
$function$;

revoke all on function public.list_public_calendar_resources(text) from public;
grant execute on function public.list_public_calendar_resources(text) to anon, authenticated;
