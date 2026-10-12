begin;
-- Public directory data only. Never expose contact details or admin fields.
create or replace function public.list_network_clubs_v2()
returns table (name text, slug text, logo_url text)
language sql stable security definer set search_path = ''
as $$
  select c.name, c.slug,
    case
      when c.logo_url ~* '^https://[^[:space:]]+$' then c.logo_url
      else null
    end
  from public.clubs c
  order by c.name, c.slug;
$$;
revoke all on function public.list_network_clubs_v2() from public, anon, authenticated;
grant execute on function public.list_network_clubs_v2() to anon, authenticated;
commit;
