-- Minimal dependencies for the actual tournament core migration. CI only.
create table public.club_seasons (
 id uuid primary key, club_id uuid not null references public.clubs(id),
 name text not null, starts_on date not null, ends_on date not null, is_active boolean not null default true
);
create table public.reservable_resources (
 id uuid primary key, club_id uuid not null references public.clubs(id),
 name text not null, is_active boolean not null default true
);
insert into public.club_seasons values
 ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','2027','2027-01-01','2027-12-31',true),
 ('70000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','2027','2027-01-01','2027-12-31',true);
insert into public.reservable_resources values
 ('71000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Terrain A',true),
 ('71000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Terrain B',true);
