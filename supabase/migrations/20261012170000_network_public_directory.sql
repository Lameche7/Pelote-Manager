begin;

-- Public catalog: only public club names and slugs, never members or private settings.
create or replace function public.list_network_clubs()
returns table (name text, slug text)
language sql stable security definer set search_path = ''
as $$
  select c.name, c.slug
  from public.clubs c
  order by c.name, c.slug;
$$;

revoke all on function public.list_network_clubs() from public, anon, authenticated;
grant execute on function public.list_network_clubs() to anon, authenticated;

commit;
