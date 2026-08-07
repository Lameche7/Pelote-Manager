-- Repair PR60 media storage after partial/manual application.
-- This migration is intentionally idempotent for the bucket and RLS policies.

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

grant select, insert, delete on table public.club_tv_media to authenticated;

drop policy if exists club_tv_media_admin_read on public.club_tv_media;
create policy club_tv_media_admin_read
on public.club_tv_media
for select
to authenticated
using (
  club_id = public.admin_current_club_id()
  and public.has_club_permission(club_id, 'club.manage')
);

drop policy if exists club_tv_media_admin_insert on public.club_tv_media;
create policy club_tv_media_admin_insert
on public.club_tv_media
for insert
to authenticated
with check (
  club_id = public.admin_current_club_id()
  and public.has_club_permission(club_id, 'club.manage')
  and storage_path like club_id::text || '/%'
);

drop policy if exists club_tv_media_admin_delete on public.club_tv_media;
create policy club_tv_media_admin_delete
on public.club_tv_media
for delete
to authenticated
using (
  club_id = public.admin_current_club_id()
  and public.has_club_permission(club_id, 'club.manage')
);

drop policy if exists club_tv_media_storage_admin_read on storage.objects;
create policy club_tv_media_storage_admin_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'club-tv-media'
  and (storage.foldername(name))[1] = public.admin_current_club_id()::text
  and public.has_club_permission(public.admin_current_club_id(), 'club.manage')
);

drop policy if exists club_tv_media_storage_admin_insert on storage.objects;
create policy club_tv_media_storage_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'club-tv-media'
  and (storage.foldername(name))[1] = public.admin_current_club_id()::text
  and public.has_club_permission(public.admin_current_club_id(), 'club.manage')
);

drop policy if exists club_tv_media_storage_admin_delete on storage.objects;
create policy club_tv_media_storage_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'club-tv-media'
  and (storage.foldername(name))[1] = public.admin_current_club_id()::text
  and public.has_club_permission(public.admin_current_club_id(), 'club.manage')
);
