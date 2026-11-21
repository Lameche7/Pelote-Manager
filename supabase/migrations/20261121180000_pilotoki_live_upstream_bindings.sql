-- Internal mapping between a scheduled Pilotoki broadcast and a controlled Upstream stream.
-- No browser role can read or mutate the mapping.
begin;
create unique index if not exists pilotoki_live_videos_id_club_unique
  on public.pilotoki_live_videos(id, club_id);
create table if not exists public.pilotoki_live_upstream_bindings (
  video_id uuid primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  upstream_stream_id uuid not null unique,
  created_at timestamptz not null default now(),
  constraint upstream_binding_video_club_fk
    foreign key (video_id, club_id)
    references public.pilotoki_live_videos(id, club_id) on delete cascade
);
create index if not exists pilotoki_live_upstream_bindings_club_idx
  on public.pilotoki_live_upstream_bindings(club_id);
alter table public.pilotoki_live_upstream_bindings enable row level security;
revoke all on public.pilotoki_live_upstream_bindings from public, anon, authenticated;
grant all on public.pilotoki_live_upstream_bindings to service_role;
commit;
