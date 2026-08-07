create table if not exists public.club_media_assets (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  kind text not null check (kind in ('dotation', 'partner')),
  label text not null default '' check (char_length(label) <= 120),
  storage_path text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint club_media_assets_storage_path_matches_club check (
    storage_path like club_id::text || '/' || kind || '/%'
  )
);

create index if not exists club_media_assets_club_kind_order_idx
  on public.club_media_assets (club_id, kind, sort_order, created_at);

alter table public.club_media_assets enable row level security;

revoke all on table public.club_media_assets from anon;
grant select, insert, update, delete on table public.club_media_assets to authenticated;

drop policy if exists club_media_assets_admin_select on public.club_media_assets;
create policy club_media_assets_admin_select
on public.club_media_assets
for select
to authenticated
using (public.has_club_permission(club_id, 'club.manage'));

drop policy if exists club_media_assets_admin_insert on public.club_media_assets;
create policy club_media_assets_admin_insert
on public.club_media_assets
for insert
to authenticated
with check (public.has_club_permission(club_id, 'club.manage'));

drop policy if exists club_media_assets_admin_update on public.club_media_assets;
create policy club_media_assets_admin_update
on public.club_media_assets
for update
to authenticated
using (public.has_club_permission(club_id, 'club.manage'))
with check (public.has_club_permission(club_id, 'club.manage'));

drop policy if exists club_media_assets_admin_delete on public.club_media_assets;
create policy club_media_assets_admin_delete
on public.club_media_assets
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
  'club-media',
  'club-media',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_manage_club_media_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  folders text[] := storage.foldername(object_name);
  target_club uuid;
begin
  if coalesce(array_length(folders, 1), 0) < 2 then
    return false;
  end if;

  if folders[2] not in ('dotation', 'partner') then
    return false;
  end if;

  begin
    target_club := folders[1]::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;

  return public.has_club_permission(target_club, 'club.manage');
end;
$$;

revoke all on function public.can_manage_club_media_object(text) from public;
grant execute on function public.can_manage_club_media_object(text) to authenticated;

drop policy if exists club_media_objects_admin_select on storage.objects;
create policy club_media_objects_admin_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'club-media'
  and public.can_manage_club_media_object(name)
);

drop policy if exists club_media_objects_admin_insert on storage.objects;
create policy club_media_objects_admin_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'club-media'
  and public.can_manage_club_media_object(name)
);

drop policy if exists club_media_objects_admin_update on storage.objects;
create policy club_media_objects_admin_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'club-media'
  and public.can_manage_club_media_object(name)
)
with check (
  bucket_id = 'club-media'
  and public.can_manage_club_media_object(name)
);

drop policy if exists club_media_objects_admin_delete on storage.objects;
create policy club_media_objects_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'club-media'
  and public.can_manage_club_media_object(name)
);

create or replace function public.get_public_tv_media(target_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings public.club_tv_settings;
begin
  select tv_settings.*
  into settings
  from public.club_tv_settings as tv_settings
  where tv_settings.public_token = target_token;

  if settings.club_id is null or not settings.is_enabled then
    return jsonb_build_object(
      'dotations', '[]'::jsonb,
      'partners', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'dotations', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', media.id,
            'label', media.label,
            'storage_path', media.storage_path
          )
          order by media.sort_order, media.created_at
        )
        from (
          select assets.*
          from public.club_media_assets as assets
          where assets.club_id = settings.club_id
            and assets.kind = 'dotation'
            and assets.is_active
          order by assets.sort_order, assets.created_at
          limit 8
        ) as media
      ),
      '[]'::jsonb
    ),
    'partners', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', media.id,
            'label', media.label,
            'storage_path', media.storage_path
          )
          order by media.sort_order, media.created_at
        )
        from (
          select assets.*
          from public.club_media_assets as assets
          where assets.club_id = settings.club_id
            and assets.kind = 'partner'
            and assets.is_active
          order by assets.sort_order, assets.created_at
          limit 12
        ) as media
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.get_public_tv_media(uuid) from public;
grant execute on function public.get_public_tv_media(uuid) to anon, authenticated;
