-- Run after network-user-admin-fixture.sql, in ephemeral PostgreSQL only.
create role service_role nologin;
create table auth.users (id uuid primary key);
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
alter table public.clubs add column name text not null default 'Club de test';
update public.clubs set name = case
  when id = '00000000-0000-0000-0000-000000000001' then 'Club A'
  else 'Club B'
end;
insert into auth.users(id)
select id from public.profiles;
create function public.get_my_club_access()
returns table(club_id uuid, club_name text, permission_keys text[])
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, array_agg(p.permission_key order by p.permission_key)
  from public.club_memberships m
  join public.clubs c on c.id = m.club_id
  join public.club_role_permissions p on p.role_id = m.role_id
  where m.profile_id = auth.uid()
  group by c.id, c.name
$$;
