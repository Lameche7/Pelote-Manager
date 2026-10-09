-- Schéma minimal isolé pour tester la migration PR #330 sur PostgreSQL.
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create type public.user_role as enum ('visitor','user','member','admin');
create type public.club_role_key as enum ('administrator','manager','treasurer','viewer','other');
create table public.profiles(
 id uuid primary key, email text not null, first_name text,last_name text,display_name text,
 role public.user_role not null default 'visitor',sport_player_id uuid,member_id uuid,
 created_at timestamptz default now(),updated_at timestamptz default now()
);
create table public.clubs(id uuid primary key);
create table public.club_roles(id uuid primary key,club_id uuid references public.clubs(id),key public.club_role_key not null);
create table public.club_memberships(
 club_id uuid references public.clubs(id),profile_id uuid references public.profiles(id),
 role_id uuid references public.club_roles(id),primary key(club_id,profile_id)
);
create table public.club_members(id uuid primary key,club_id uuid references public.clubs(id),sport_player_id uuid,is_active boolean default true);
create table public.club_role_permissions(role_id uuid,permission_key text);
create function public.admin_current_club_id() returns uuid
 language plpgsql stable security definer set search_path='' as $$
 declare n int; cid uuid;
 begin
 select count(*),(array_agg(club_id))[1] into n,cid from public.club_memberships
 where profile_id=auth.uid();
 if n!=1 then raise exception 'Club selection required' using errcode='P0003'; end if;
 return cid;
 end $$;
create function public.has_club_permission(cid uuid,perm text) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.club_memberships cm
 join public.club_role_permissions cp on cp.role_id=cm.role_id
 where cm.profile_id=auth.uid() and cm.club_id=cid and cp.permission_key=perm)
 $$;
create function public.is_active_licensee_for_club(pid uuid,cid uuid,dt date default current_date)
 returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.club_members m
 on m.club_id=cid and m.is_active and
 (m.sport_player_id=p.sport_player_id and p.sport_player_id is not null or m.id=p.member_id)
 where p.id=pid)
 $$;
insert into public.clubs values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.club_roles values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','administrator'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','administrator');
insert into public.club_role_permissions values
 ('10000000-0000-0000-0000-000000000001','settings.manage'),
 ('10000000-0000-0000-0000-000000000002','settings.manage');
insert into public.profiles(id,email,sport_player_id) values
 ('20000000-0000-0000-0000-000000000001','admin-a@test.local',null),
 ('20000000-0000-0000-0000-000000000002','admin-b@test.local',null),
 ('20000000-0000-0000-0000-000000000003','player-a@test.local','30000000-0000-0000-0000-000000000003'),
 ('20000000-0000-0000-0000-000000000004','player-b@test.local','30000000-0000-0000-0000-000000000004'),
 ('20000000-0000-0000-0000-000000000005','multi-player@test.local','30000000-0000-0000-0000-000000000005');
insert into public.club_memberships values
 ('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
insert into public.club_members(id,club_id,sport_player_id) values
 ('40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003'),
 ('40000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000004'),
 ('40000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005'),
 ('40000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000005');
