-- Public branding only: keep the existing v2 RPC contract unchanged.
create or replace function public.list_network_clubs_v3()
returns table(name text, slug text, logo_url text, hero_image_url text)
language sql stable security definer
set search_path = ''
as $network_clubs$
  select c.name, c.slug,
    case when c.logo_url ~* '^https://[^[:space:]]+$' then c.logo_url else null end,
    case when c.hero_image_url ~* '^https://[^[:space:]]+$' then c.hero_image_url else null end
  from public.clubs c
  order by c.name, c.slug;
$network_clubs$;
revoke all on function public.list_network_clubs_v3() from public;
grant execute on function public.list_network_clubs_v3() to anon, authenticated;
