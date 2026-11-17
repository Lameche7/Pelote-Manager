-- Pilotoki Live: club-scoped preparation only; no credentials or streams.
-- The channel identifier is public. OAuth access/refresh tokens must later be
-- handled server-side in a private, encrypted integration, never in this table.
create table if not exists public.club_live_settings (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  youtube_channel_id text,
  youtube_channel_label text not null default '',
  broadcaster_policy text not null default 'admin_only'
    check (broadcaster_policy in ('admin_only','participants','approval_required')),
  allow_replays boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_live_youtube_channel_id_format check (
    youtube_channel_id is null or youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$'
  )
);
alter table public.club_live_settings enable row level security;
revoke all on public.club_live_settings from public, anon, authenticated;

-- Initial public channel mapping for Lourdes only. No Google account is
-- connected; no live can be initiated with this metadata alone.
insert into public.club_live_settings (club_id,youtube_channel_id,youtube_channel_label)
values ('188029a8-3e6a-41cd-821f-01984a703552',
        'UCAIME5j0y9DdiEQNyttO_jw','Chaîne du Pelotaris Club Lourdais')
on conflict (club_id) do nothing;

create or replace function public.admin_get_club_live_settings()
returns jsonb language plpgsql stable security definer
set search_path = ''
as $function$
declare
  target_club uuid;
  settings public.club_live_settings;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode='42501';
  end if;
  target_club := public.admin_current_club_id();
  if not public.has_club_permission(target_club,'settings.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  select * into settings from public.club_live_settings where club_id=target_club;
  return jsonb_build_object(
    'club_id',target_club,
    'youtube_channel_id',settings.youtube_channel_id,
    'youtube_channel_label',coalesce(settings.youtube_channel_label,''),
    'broadcaster_policy',coalesce(settings.broadcaster_policy,'admin_only'),
    'allow_replays',coalesce(settings.allow_replays,true),
    'connection_status','awaiting_google_authorization',
    'broadcast_available',false
  );
end;
$function$;

create or replace function public.admin_save_club_live_settings(payload jsonb)
returns jsonb language plpgsql security definer
set search_path = ''
as $function$
declare
  target_club uuid;
  channel_id text;
  channel_label text;
  policy text;
  replays boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode='42501';
  end if;
  target_club := public.admin_current_club_id();
  if not public.has_club_permission(target_club,'settings.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  if payload is null or jsonb_typeof(payload)<>'object' then
    raise exception 'Invalid settings payload' using errcode='22023';
  end if;
  if payload ? 'club_id' or payload ? 'connection_status' or
     payload ? 'broadcast_available' or payload ? 'oauth_token' then
    raise exception 'Protected fields cannot be supplied' using errcode='22023';
  end if;
  channel_id := nullif(btrim(payload->>'youtube_channel_id'),'');
  channel_label := btrim(coalesce(payload->>'youtube_channel_label',''));
  policy := coalesce(payload->>'broadcaster_policy','admin_only');
  replays := coalesce((payload->>'allow_replays')::boolean,true);
  if channel_id is not null and channel_id !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'Invalid YouTube channel ID' using errcode='22023';
  end if;
  if char_length(channel_label)>120 then
    raise exception 'Channel label too long' using errcode='22023';
  end if;
  if policy not in ('admin_only','participants','approval_required') then
    raise exception 'Invalid broadcaster policy' using errcode='22023';
  end if;
  insert into public.club_live_settings as settings
    (club_id,youtube_channel_id,youtube_channel_label,broadcaster_policy,allow_replays)
  values (target_club,channel_id,channel_label,policy,replays)
  on conflict (club_id) do update set
    youtube_channel_id=excluded.youtube_channel_id,
    youtube_channel_label=excluded.youtube_channel_label,
    broadcaster_policy=excluded.broadcaster_policy,
    allow_replays=excluded.allow_replays,
    updated_at=now();
  return public.admin_get_club_live_settings();
end;
$function$;

revoke all on function public.admin_get_club_live_settings() from public,anon;
revoke all on function public.admin_save_club_live_settings(jsonb) from public,anon;
grant execute on function public.admin_get_club_live_settings() to authenticated;
grant execute on function public.admin_save_club_live_settings(jsonb) to authenticated;
