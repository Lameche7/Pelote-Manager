import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read(
  "../supabase/migrations/20261119150000_pilotoki_live_shared_channel.sql",
);
const shared = read("../api/_live-google-shared.mjs");
const page = read("../src/features/admin/live/pages/AdminLiveSettingsPage.tsx");
const service = read(
  "../src/features/admin/live/services/adminLiveSettingsService.ts",
);
const network = read("../src/features/network/pages/NetworkVideosPage.tsx");

test("Google credentials belong to one protected Pilotoki channel", () => {
  assert.match(migration, /create table public.pilotoki_live_youtube_channel/);
  assert.match(
    migration,
    /create table public.pilotoki_live_google_credentials/,
  );
  assert.match(migration, /id boolean primary key default true check \(id\)/);
  assert.match(
    migration,
    /revoke all on public.pilotoki_live_google_credentials from public,anon,authenticated/,
  );
  assert.match(shared, /pilotoki_live_google_credentials\?on_conflict=id/);
  assert.match(shared, /settings.can_connect_google !== true/);
});

test("Clubs retain their live policy but may not edit the common YouTube identity", () => {
  assert.match(migration, /payload \? 'youtube_channel_id'/);
  assert.match(migration, /payload \? 'youtube_channel_label'/);
  assert.doesNotMatch(service, /youtube_channel_id: settings.youtubeChannelId/);
  assert.match(page, /Chaîne YouTube Pilotoki/);
  assert.match(page, /settings.canConnectGoogle/);
});

test("Club-linked video registry exposes published items only", () => {
  assert.match(
    migration,
    /club_id uuid not null references public.clubs\(id\)/,
  );
  assert.match(migration, /youtube_video_id text unique/);
  assert.match(migration, /using\(status in \('live','replay'\)\)/);
  assert.match(network, /Voir la chaîne Pilotoki/);
});
