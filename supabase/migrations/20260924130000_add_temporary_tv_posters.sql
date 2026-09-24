alter table public.club_tv_media
  drop constraint if exists club_tv_media_kind_check;

alter table public.club_tv_media
  add constraint club_tv_media_kind_check
  check (kind in ('shop', 'partner', 'poster'));

alter table public.club_tv_media
  add column if not exists active_until timestamptz;

create index if not exists club_tv_media_active_until_idx
on public.club_tv_media (club_id, kind, active_until)
where kind = 'poster';

drop function if exists public.list_public_tv_media(uuid);

create function public.list_public_tv_media(target_token uuid)
returns table (
  id uuid,
  kind text,
  storage_path text,
  original_name text,
  active_until timestamptz
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
    media.original_name,
    media.active_until
  from public.club_tv_settings as settings
  join public.club_tv_media as media
    on media.club_id = settings.club_id
  where settings.public_token = target_token
    and settings.is_enabled
    and (
      media.kind <> 'poster'
      or media.active_until > now()
    )
  order by media.kind, media.created_at, media.id;
$$;

revoke all on function public.list_public_tv_media(uuid) from public;
grant execute on function public.list_public_tv_media(uuid) to anon, authenticated;
