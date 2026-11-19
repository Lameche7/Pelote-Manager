-- Per-club encrypted Google refresh tokens. The encryption key is stored
-- exclusively in Vercel; no Google token is exposed by any public RPC.
begin;
create table if not exists public.club_live_google_credentials (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  channel_id text not null check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.club_live_google_credentials enable row level security;
revoke all on public.club_live_google_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.club_live_google_credentials to service_role;

-- The status RPC only reveals whether the channel is linked, never credentials.
create or replace function public.admin_get_club_live_settings()
returns jsonb language plpgsql stable security definer
set search_path = ''
as $function$
declare
  target_club uuid;
  settings public.club_live_settings;
  connected boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode='42501';
  end if;
  target_club := public.admin_current_club_id();
  if not public.has_club_permission(target_club,'settings.manage') then
    raise exception 'Forbidden' using errcode='42501';
  end if;
  select * into settings from public.club_live_settings where club_id=target_club;
  select exists(
    select 1 from public.club_live_google_credentials credential
    where credential.club_id=target_club
      and credential.channel_id=settings.youtube_channel_id
  ) into connected;
  return jsonb_build_object(
    'club_id',target_club,
    'youtube_channel_id',settings.youtube_channel_id,
    'youtube_channel_label',coalesce(settings.youtube_channel_label,''),
    'broadcaster_policy',coalesce(settings.broadcaster_policy,'admin_only'),
    'allow_replays',coalesce(settings.allow_replays,true),
    'connection_status',
       case when connected then 'connected' else 'awaiting_google_authorization' end,
    -- Transcoding/mobile streaming gateway remains a separate step.
    'broadcast_available',false
  );
end;
$function$;
revoke all on function public.admin_get_club_live_settings() from public,anon;
grant execute on function public.admin_get_club_live_settings() to authenticated;
commit;
