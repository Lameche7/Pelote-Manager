import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const migration = read(
  "../supabase/migrations/20261117121000_pilotoki_live_admin_settings.sql",
);
const adminPage = read(
  "../src/features/admin/live/pages/AdminLiveSettingsPage.tsx",
);
const service = read(
  "../src/features/admin/live/services/adminLiveSettingsService.ts",
);
const router = read("../src/app/router.tsx");
const navigation = read("../src/features/admin/config/adminPermissions.ts");

test("the PCL YouTube channel is configured as public metadata only", () => {
  assert.match(migration, /UCAIME5j0y9DdiEQNyttO_jw/);
  assert.match(migration, /on conflict \(club_id\) do nothing/);
  assert.match(
    migration,
    /club_id uuid primary key references public\.clubs\(id\)/,
  );
  assert.doesNotMatch(migration, /refresh_token\s+text/i);
  assert.doesNotMatch(migration, /stream_key\s+text/i);
  assert.match(
    migration,
    /alter table public\.club_live_settings enable row level security/,
  );
  assert.match(
    migration,
    /revoke all on public\.club_live_settings from public, anon, authenticated/,
  );
});

test("admin Live RPCs enforce server-side permissions and refuse privileged fields", () => {
  assert.match(migration, /public\.admin_current_club_id\(\)/);
  assert.match(
    migration,
    /public\.has_club_permission\(target_club,'settings\.manage'\)/,
  );
  assert.match(migration, /payload \? 'connection_status'/);
  assert.match(migration, /'broadcast_available',false/);
  assert.match(migration, /to authenticated/);
  assert.match(service, /admin_get_club_live_settings/);
  assert.match(service, /admin_save_club_live_settings/);
});

test("Pilotoki Live exposes the working mobile broadcast and preserves Google consent", () => {
  assert.match(adminPage, /Diffuser la partie/);
  assert.match(adminPage, /Diffusion mobile Pilotoki Live via LiveKit/);
  assert.match(adminPage, /Autorisation Google/);
  assert.match(router, /path: "parametres\/live"/);
  assert.match(navigation, /label: "Pilotoki Live"/);
  assert.match(router, /<AdminLiveSettingsPage/);
});

test("Google authorization is server-only, club-scoped and launch stays disabled", () => {
  const start = read("../api/live-google-connect.mjs");
  const callback = read("../api/live-google-callback.mjs");
  const shared = read("../api/_live-google-shared.mjs");
  const credentials = read(
    "../supabase/migrations/20261119110000_pilotoki_live_google_oauth_storage.sql",
  );
  assert.match(start, /verifiedClubSettings/);
  assert.match(start, /access_type:\s*"offline"/);
  assert.match(start, /stateCookie/);
  assert.match(callback, /verifyState/);
  assert.ok(callback.includes("channels?part=id&mine=true"));
  assert.match(callback, /channel\.id\s*===\s*claims\.channelId/);
  assert.match(callback, /encryptRefreshToken/);
  assert.match(shared, /aes-256-gcm/);
  assert.match(shared, /admin_get_club_live_settings/);
  assert.match(credentials, /enable row level security/);
  assert.match(
    credentials,
    /revoke all on public.club_live_google_credentials/,
  );
  assert.match(credentials, /'broadcast_available',false/);
  assert.match(service, /connectGoogle/);
  assert.match(adminPage, /Connecter la chaîne avec Google/);
  const readiness = read("../api/_live-google-configuration.mjs");
  assert.match(readiness, /YOUTUBE_OAUTH_CLIENT_ID/);
  assert.match(readiness, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(readiness, /json\(\{ configured \}\)/);
  assert.doesNotMatch(readiness, /JSON\.stringify\(process\.env\)/);

  assert.match(adminPage, /!googleConfigured/);
  assert.match(adminPage, /live-google-configuration/);
});
