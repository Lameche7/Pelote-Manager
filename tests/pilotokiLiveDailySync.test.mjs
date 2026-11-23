import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  encryptRefreshToken,
  LiveAuthError,
} from "../api/_live-google-shared.mjs";
import {
  authorizedCron,
  reconcileDailyVideos,
} from "../api/_live-youtube-daily-sync.mjs";

const clubId = "188029a8-3e6a-41cd-821f-01984a703552";
const env = {
  CRON_SECRET: "test-only-cron-secret-with-at-least-32-characters",
  VITE_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-only",
  YOUTUBE_OAUTH_CLIENT_ID: "test-client",
  YOUTUBE_OAUTH_CLIENT_SECRET: "test-client-secret",
  YOUTUBE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

test("Cron requires a shared server-only secret", () => {
  assert.throws(
    () => authorizedCron({ headers: {} }, env),
    (error) => error instanceof LiveAuthError && error.status === 401,
  );
  assert.throws(
    () =>
      authorizedCron(
        { headers: { authorization: "Bearer wrong-secret" } },
        env,
      ),
    LiveAuthError,
  );
  assert.doesNotThrow(() =>
    authorizedCron(
      { headers: { authorization: `Bearer ${env.CRON_SECRET}` } },
      env,
    ),
  );
});

test("Daily reconciliation avoids YouTube entirely when no unfinished videos exist", async () => {
  const calls = [];
  const result = await reconcileDailyVideos(env, async (url) => {
    calls.push(url);
    return { ok: true, json: async () => [] };
  });
  assert.deepEqual(result, { clubs: 0, updated: 0 });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /status=in.%28scheduled%2Clive%2Creplay%29/);
});

test("Daily reconciliation updates completed videos without exposing credentials", async () => {
  const encrypted = encryptRefreshToken(env, "test-only-refresh-token");
  const requests = [];
  const mockFetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes("pilotoki_live_youtube_channel"))
      return {
        ok: true,
        json: async () => [{ channel_id: "UCAIME5j0y9DdiEQNyttO_jw" }],
      };
    if (url.includes("pilotoki_live_google_credentials"))
      return {
        ok: true,
        json: async () => [
          {
            channel_id: "UCAIME5j0y9DdiEQNyttO_jw",
            refresh_token_ciphertext: encrypted.ciphertext,
            refresh_token_iv: encrypted.iv,
          },
        ],
      };
    if (url.includes("oauth2.googleapis.com/token"))
      return { ok: true, json: async () => ({ access_token: "test-oauth" }) };
    if (url.includes("youtube/v3/liveBroadcasts"))
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "abcdefghi12",
              status: { lifeCycleStatus: "complete", privacyStatus: "public" },
            },
          ],
        }),
      };
    if (options.method === "PATCH") return { ok: true };
    if (url.includes("pilotoki_live_videos?")) {
      if (url.includes("select=club_id"))
        return { ok: true, json: async () => [{ club_id: clubId }] };
      return {
        ok: true,
        json: async () => [
          {
            id: "22222222-2222-4222-8222-222222222222",
            youtube_video_id: "abcdefghi12",
            status: "scheduled",
            started_at: null,
          },
        ],
      };
    }
    throw new Error("Unexpected request");
  };
  const result = await reconcileDailyVideos(env, mockFetch);
  assert.deepEqual(result, { clubs: 1, updated: 1 });
  const patch = requests.find((request) => request.options.method === "PATCH");
  assert.equal(JSON.parse(patch.options.body).status, "replay");
  assert.match(patch.url, /club_id=eq\./);
  assert.ok(
    requests.every(
      ({ options }) =>
        options.headers?.apikey === "sb_secret_test-only" ||
        !options.headers?.apikey,
    ),
  );
});

test("Cron routes through an existing deployed API function", () => {
  const configuration = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  const prepare = readFileSync(
    new URL("../api/live-youtube-prepare.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(configuration.crons[0].path, "/api/live-youtube-prepare");
  assert.match(prepare, /authorizedCron\(request, process\.env\)/);
  assert.match(prepare, /reconcileDailyVideos\(process\.env\)/);
});
