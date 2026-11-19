-- Private RTMPS ingestion metadata for each scheduled Pilotoki YouTube broadcast.
-- Never expose RTMPS addresses, stream names or their ciphertexts to club users.
create table if not exists public.pilotoki_live_ingest_credentials (
  video_id uuid primary key references public.pilotoki_live_videos(id) on delete cascade,
  youtube_stream_id text not null,
  ingest_ciphertext text not null,
  ingest_iv text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pilotoki_live_ingest_credentials enable row level security;
revoke all on public.pilotoki_live_ingest_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.pilotoki_live_ingest_credentials to service_role;

comment on table public.pilotoki_live_ingest_credentials is
  'Server-only AES-256-GCM encrypted YouTube RTMPS ingestion credentials, linked to a club video.';
