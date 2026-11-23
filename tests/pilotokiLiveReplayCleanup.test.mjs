import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { encryptRefreshToken, LiveAuthError } from "../api/_live-google-shared.mjs";
import { synchronizeClubVideos } from "../api/_live-youtube-broadcast.mjs";

const clubId = "188029a8-3e6a-41cd-821f-01984a703552";
const videoId = "abcdefghi12";
const env = {
  VITE_SUPABASE_URL: "https://test.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-only",
  YOUTUBE_OAUTH_CLIENT_ID: "client",
  YOUTUBE_OAUTH_CLIENT_SECRET: "secret",
  YOUTUBE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

function mock({ youtubeBroadcasts = [], youtubeVideos = [], youtubeVideosOk = true, status = "replay" } = {}) {
  const encrypted = encryptRefreshToken(env, "test-refresh-token");
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    const name = String(url);
    calls.push({ url: name, options });
    if (name.includes("/rest/v1/pilotoki_live_videos?") && options.method !== "PATCH")
      return { ok: true, json: async () => [{
        id: "22222222-2222-4222-8222-222222222222",
        youtube_video_id: videoId,
        status,
        started_at: "2026-11-23T10:00:00Z",
      }] };
    if (name.includes("pilotoki_live_google_credentials"))
      return { ok: true, json: async () => [{
        channel_id: "UCAIME5j0y9DdiEQNyttO_jw",
        refresh_token_ciphertext: encrypted.ciphertext,
        refresh_token_iv: encrypted.iv,
      }] };
    if (name.includes("oauth2.googleapis.com/token"))
      return { ok: true, json: async () => ({ access_token: "owner-oauth" }) };
    if (name.includes("/youtube/v3/liveBroadcasts?"))
      return { ok: true, json: async () => ({ items: youtubeBroadcasts }) };
    if (name.includes("/youtube/v3/videos?"))
      return { ok: youtubeVideosOk, json: async () => ({ items: youtubeVideos }) };
    if (options.method === "PATCH") return { ok: true };
    throw new Error("Unexpected URL " + name);
  };
  return { calls, fetchMock };
}

test("Deleted replay is hidden only when broadcasts AND videos API confirm absence", async () => {
  const fixture = mock();
  const count = await synchronizeClubVideos(
    env, clubId, "UCAIME5j0y9DdiEQNyttO_jw", fixture.fetchMock,
  );
  assert.equal(count, 1);
  const patch = fixture.calls.find((c) => c.options.method === "PATCH");
  assert.equal(JSON.parse(patch.options.body).status, "hidden");
  assert.match(patch.url, /status=eq.replay/);
  assert.match(patch.url, /youtube_video_id=eq.abcdefghi12/);
  assert.ok(!fixture.calls.some((c) => c.options.method === "DELETE"));
});

test("An archived YouTube video no longer listed as a broadcast stays public", async () => {
  const fixture = mock({ youtubeVideos: [{ id: videoId }] });
  assert.equal(
    await synchronizeClubVideos(env, clubId, "UCAIME5j0y9DdiEQNyttO_jw", fixture.fetchMock),
    0,
  );
  assert.ok(!fixture.calls.some((c) => c.options.method === "PATCH"));
});

test("YouTube verification error never removes replay", async () => {
  const fixture = mock({ youtubeVideosOk: false });
  await assert.rejects(
    synchronizeClubVideos(env, clubId, "UCAIME5j0y9DdiEQNyttO_jw", fixture.fetchMock),
    (reason) => reason instanceof LiveAuthError && reason.status === 502,
  );
  assert.ok(!fixture.calls.some((c) => c.options.method === "PATCH"));
});

test("A scheduled event with a missing YouTube link stays repairable", async () => {
  const fixture = mock({ status: "scheduled" });
  assert.equal(
    await synchronizeClubVideos(env, clubId, "UCAIME5j0y9DdiEQNyttO_jw", fixture.fetchMock),
    0,
  );
  assert.ok(!fixture.calls.some((c) => c.options.method === "PATCH"));
});

test("TEMP: canonical prettier contents", async () => {
  const prettier = await import("prettier");
  for (const name of [
    "api/_live-calendar-match.mjs",
    "api/_live-youtube-broadcast.mjs",
    "api/live-youtube-prepare.mjs",
    "src/features/admin/live/pages/PilotokiLiveMatchLaunchPage.tsx",
    "tests/calendarLiveComingSoon.test.mjs",
    "tests/pilotokiLiveCalendarMatch.test.mjs",
    "tests/pilotokiLiveRecover.test.mjs",
    "tests/pilotokiLiveReplayCleanup.test.mjs",
  ]) {
    const filePath = new URL(`../${name}`, import.meta.url);
    const original = readFileSync(filePath, "utf8");
    const formatted = await prettier.format(original, { filepath: filePath.pathname });
    console.log("LIVE626FMT_BEGIN:" + name + ":" + Buffer.from(formatted).toString("base64") + ":LIVE626FMT_END");
  }
});
