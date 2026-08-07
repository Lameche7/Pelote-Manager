create table public.club_tv_media (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  kind text not null check (kind in ('shop', 'partner')),
  storage_path text not null check (btrim(storage_path) <> ''),
  original_name text not null check (btrim(original_name) <> ''),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  unique (club_id, storage_path)
);

create index club_tv_media_club_kind_created_idx
on public.club_tv_media (club_id, kind, created_at, id);

alter table public.club_tv_media enable row level security;

grant select, insert, delete on table public.club_tv_media to authenticated;

create policy club_tv_media_admin_read
on public.club_tv_media
for select
to authenticated
using (public.has_club_permission(club_id, 'club.manage'));

create policy club_tv_media_admin_insert
on public.club_tv_media
for insert
to authenticated
with check (
  club_id = public.admin_current_club_id()
  and public.has_club_permission(club_id, 'club.manage')
  and storage_path like club_id::text || '/%'
);

create policy club_tv_media_admin_delete
on public.club_tv_media
for delete
to authenticated
using (public.has_club_permission(club_id, 'club.manage'));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'club-tv-media',
  'club-tv-media',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy club_tv_media_storage_admin_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'club-tv-media'
  and (storage.foldername(name))[1] = public.admin_current_club_id()::text
  and public.has_club_permission(public.admin_current_club_id(), 'club.manage')
);

create policy club_tv_media_storage_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'club-tv-media'
  and (storage.foldername(name))[1] = public.admin_current_club_id()::text
  and public.has_club_permission(public.admin_current_club_id(), 'club.manage')
);

create policy club_tv_media_storage_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'club-tv-media'
  and (storage.foldername(name))[1] = public.admin_current_club_id()::text
  and public.has_club_permission(public.admin_current_club_id(), 'club.manage')
);

create or replace function public.list_public_tv_media(target_token uuid)
returns table (
  id uuid,
  kind text,
  storage_path text,
  original_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    media.id,
    media.kind,
    media.storage_path,
    media.original_name
  from public.club_tv_settings as settings
  join public.club_tv_media as media
    on media.club_id = settings.club_id
  where settings.public_token = target_token
    and settings.is_enabled
  order by media.kind, media.created_at, media.id;
$$;

revoke all on function public.list_public_tv_media(uuid) from public;
grant execute on function public.list_public_tv_media(uuid) to anon, authenticated;
