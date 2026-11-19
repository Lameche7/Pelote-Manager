-- Shared Pilotoki YouTube identity; club settings remain club-specific.
begin;
create table public.pilotoki_live_youtube_channel (
 id boolean primary key default true check (id),
 channel_id text not null check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
 channel_label text not null default 'Pilotoki'
);
insert into public.pilotoki_live_youtube_channel values (true,'UCAIME5j0y9DdiEQNyttO_jw','Pilotoki');
alter table public.pilotoki_live_youtube_channel enable row level security;
revoke all on public.pilotoki_live_youtube_channel from public,anon,authenticated;
grant all on public.pilotoki_live_youtube_channel to service_role;
create table public.pilotoki_live_google_credentials (
 id boolean primary key default true check (id),
 channel_id text not null check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
 refresh_token_ciphertext text not null,
 refresh_token_iv text not null,
 connected_by uuid references auth.users(id) on delete set null,
 connected_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.pilotoki_live_google_credentials enable row level security;
revoke all on public.pilotoki_live_google_credentials from public,anon,authenticated;
grant all on public.pilotoki_live_google_credentials to service_role;
insert into public.pilotoki_live_google_credentials
 (id,channel_id,refresh_token_ciphertext,refresh_token_iv,connected_by,connected_at,updated_at)
select true,c.channel_id,c.refresh_token_ciphertext,c.refresh_token_iv,c.connected_by,c.connected_at,c.updated_at
from public.club_live_google_credentials c
where c.club_id='188029a8-3e6a-41cd-821f-01984a703552'
and c.channel_id='UCAIME5j0y9DdiEQNyttO_jw'
on conflict (id) do nothing;
create table public.pilotoki_live_videos (
 id uuid primary key default gen_random_uuid(),
 club_id uuid not null references public.clubs(id) on delete cascade,
 youtube_video_id text unique not null check(youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
 title text not null,
 source_type text not null default 'other' check(source_type in ('tournoi','championnat','other')),
 source_id uuid,
 status text not null default 'scheduled' check(status in ('scheduled','live','replay','hidden')),
 started_at timestamptz,
 created_at timestamptz not null default now()
);
create index pilotoki_live_videos_club_idx on public.pilotoki_live_videos(club_id,status,created_at desc);
alter table public.pilotoki_live_videos enable row level security;
revoke all on public.pilotoki_live_videos from public,anon,authenticated;
grant select on public.pilotoki_live_videos to anon,authenticated;
grant all on public.pilotoki_live_videos to service_role;
create policy "Public published Pilotoki videos" on public.pilotoki_live_videos
for select to anon,authenticated using(status in ('live','replay'));
create or replace function public.admin_get_club_live_settings()
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare
 target_club uuid;
 settings public.club_live_settings;
 channel public.pilotoki_live_youtube_channel;
 connected boolean;
begin
 if (select auth.uid()) is null then raise exception 'Not authenticated' using errcode='42501'; end if;
 target_club:=public.admin_current_club_id();
 if not public.has_club_permission(target_club,'settings.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into settings from public.club_live_settings where club_id=target_club;
 select * into channel from public.pilotoki_live_youtube_channel where id=true;
 select exists(select 1 from public.pilotoki_live_google_credentials c where c.id=true and c.channel_id=channel.channel_id) into connected;
 return jsonb_build_object(
   'club_id',target_club,
   'youtube_channel_id',channel.channel_id,
   'youtube_channel_label',channel.channel_label,
   'broadcaster_policy',coalesce(settings.broadcaster_policy,'admin_only'),
   'allow_replays',coalesce(settings.allow_replays,true),
   'connection_status',case when connected then 'connected' else 'awaiting_google_authorization' end,
   'can_connect_google',target_club='188029a8-3e6a-41cd-821f-01984a703552'::uuid,
   'broadcast_available',false
 );
end;
$function$;
revoke all on function public.admin_get_club_live_settings() from public,anon;
grant execute on function public.admin_get_club_live_settings() to authenticated;
create or replace function public.admin_save_club_live_settings(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
 target_club uuid;
 policy text;
 replays boolean;
begin
 if (select auth.uid()) is null then raise exception 'Not authenticated' using errcode='42501'; end if;
 target_club:=public.admin_current_club_id();
 if not public.has_club_permission(target_club,'settings.manage') then raise exception 'Forbidden' using errcode='42501'; end if;
 if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Invalid settings payload' using errcode='22023'; end if;
 if payload ? 'club_id' or payload ? 'connection_status' or payload ? 'broadcast_available' or payload ? 'oauth_token'
 or payload ? 'youtube_channel_id' or payload ? 'youtube_channel_label' then raise exception 'Protected fields cannot be supplied' using errcode='22023'; end if;
 policy:=coalesce(payload->>'broadcaster_policy','admin_only');
 replays:=coalesce((payload->>'allow_replays')::boolean,true);
 if policy not in ('admin_only','participants','approval_required') then raise exception 'Invalid broadcaster policy' using errcode='22023'; end if;
 insert into public.club_live_settings as s(club_id,broadcaster_policy,allow_replays)
 values(target_club,policy,replays)
 on conflict (club_id) do update set broadcaster_policy=excluded.broadcaster_policy,
 allow_replays=excluded.allow_replays,updated_at=now();
 return public.admin_get_club_live_settings();
end;
$function$;
revoke all on function public.admin_save_club_live_settings(jsonb) from public,anon;
grant execute on function public.admin_save_club_live_settings(jsonb) to authenticated;
commit;
