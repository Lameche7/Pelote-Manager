import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  encryptRefreshToken,
  LiveAuthError,
} from "../api/_live-google-shared.mjs";
import {
  decryptRefreshToken,
  googleAccessToken,
  listPreparedVideos,
  publishedStatusFromYouTube,
  synchronizeClubVideos,
  validateBroadcastInput,
  verifiedLiveClubAdmin,
  youtubeCreateBroadcast,
  youtubeBroadcastFailure,
} from "../api/_live-youtube-broadcast.mjs";

const clubId = "188029a8-3e6a-41cd-821f-01984a703552";
const env = {
  VITE_SUPABASE_URL: "https://test.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-only",
  YOUTUBE_OAUTH_CLIENT_ID: "test.apps.googleusercontent.com",
  YOUTUBE_OAUTH_CLIENT_SECRET: "test-secret",
  YOUTUBE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

test("YouTube broadcast inputs need valid title, time, explicit audience and consent", () => {
  const now = Date.now();
  const valid = {
    title: "Finale du tournoi de Lourdes",
    sourceType: "tournoi",
    sourceId: null,
    consentConfirmed: true,
    madeForKids: false,
    scheduledStartTime: new Date(now + 600_000).toISOString(),
    clubId: "another-club-must-be-ignored",
  };
  const result = validateBroadcastInput(valid, now);
  assert.equal(result.title, valid.title);
  assert.equal("clubId" in result, false);
  assert.throws(
    () => validateBroadcastInput({ ...valid, consentConfirmed: false }, now),
    LiveAuthError,
  );
  assert.throws(
    () => validateBroadcastInput({ ...valid, madeForKids: undefined }, now),
    LiveAuthError,
  );
  assert.throws(
    () =>
      validateBroadcastInput(
        { ...valid, scheduledStartTime: new Date(now - 1000).toISOString() },
        now,
      ),
    LiveAuthError,
  );
});

test("Refresh token is decrypted only server-side and never returned to client", () => {
  const original = "test-only-refresh-token-1234567";
  const encrypted = encryptRefreshToken(env, original);
  assert.equal(
    decryptRefreshToken(env, {
      refresh_token_ciphertext: encrypted.ciphertext,
      refresh_token_iv: encrypted.iv,
    }),
    original,
  );
  assert.throws(
    () =>
      decryptRefreshToken(env, {
        refresh_token_ciphertext:
          (encrypted.ciphertext[0] === "A" ? "B" : "A") +
          encrypted.ciphertext.slice(1),
        refresh_token_iv: encrypted.iv,
      }),
    LiveAuthError,
  );
});

test("Missing session blocks a user before privileged access", async () => {
  await assert.rejects(
    verifiedLiveClubAdmin({ headers: {} }, env),
    (error) => error instanceof LiveAuthError && error.status === 401,
  );
});

test("Only the selected user's authorized club is accepted", async () => {
  const requested = [];
  const mockFetch = async (url, options) => {
    requested.push({ url, options });
    if (url.endsWith("/auth/v1/user"))
      return {
        ok: true,
        json: async () => ({ id: "22222222-2222-4222-8222-222222222222" }),
      };
    return {
      ok: true,
      json: async () => ({
        club_id: clubId,
        youtube_channel_id: "UCAIME5j0y9DdiEQNyttO_jw",
        connection_status: "connected",
      }),
    };
  };
  const result = await verifiedLiveClubAdmin(
    {
      headers: { authorization: "Bearer test-user-token" },
    },
    env,
    mockFetch,
  );
  assert.equal(result.clubId, clubId);
  assert.equal(requested.length, 2);
  assert.match(requested[1].url, /rpc\/admin_get_club_live_settings/);
});

test("A scheduled broadcast stays unlisted and does not auto-start video", async () => {
  let body;
  const fetchMock = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: "abcdefghi12" }) };
  };
  const id = await youtubeCreateBroadcast(
    "test-access",
    {
      title: "Finale Lourdes",
      scheduledStartTime: "2026-12-01T19:00:00.000Z",
      madeForKids: false,
    },
    fetchMock,
  );
  assert.equal(id, "abcdefghi12");
  assert.equal(body.status.privacyStatus, "unlisted");
  assert.equal(body.contentDetails.enableAutoStart, false);
  assert.equal(body.contentDetails.enableAutoStop, false);
});

test("Prepared videos are queried with an authenticated club-scoped filter", async () => {
  let observed;
  const mockFetch = async (url, options) => {
    observed = { url, options };
    return {
      ok: true,
      json: async () => [
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Finale Lourdes",
          youtube_video_id: "abcdefghi12",
          status: "scheduled",
          source_type: "tournoi",
          created_at: "2026-11-19T12:00:00Z",
        },
      ],
    };
  };
  const result = await listPreparedVideos(env, clubId, mockFetch);
  assert.equal(result.length, 1);
  assert.equal(
    result[0].youtubeUrl,
    "https://www.youtube.com/watch?v=abcdefghi12",
  );
  assert.match(observed.url, /club_id=eq\./);
  assert.equal(observed.options.headers.apikey, "sb_secret_test-only");
  assert.equal(observed.options.headers.authorization, undefined);
});

test("A missing or expired Google refresh token prevents YouTube calls", async () => {
  const encrypted = encryptRefreshToken(env, "test-only-refresh-token-1234567");
  const mockFetch = async (url) => {
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
    return { ok: false };
  };
  await assert.rejects(
    googleAccessToken(env, "UCAIME5j0y9DdiEQNyttO_jw", mockFetch),
    (error) => error instanceof LiveAuthError && error.status === 503,
  );
});

test("YouTube failures expose only safe allowlisted reasons", async () => {
  const failure = await youtubeBroadcastFailure({
    status: 403,
    json: async () => ({
      error: {
        message: "secret-response-message-not-to-disclose",
        errors: [{ reason: "liveStreamingNotEnabled" }],
      },
    }),
  });
  assert.equal(failure.status, 502);
  assert.match(failure.message, /liveStreamingNotEnabled/);
  assert.match(failure.message, /YouTube HTTP 403/);
  assert.doesNotMatch(
    failure.message,
    /secret-response-message-not-to-disclose/,
  );
});

test("Unknown or invalid YouTube errors stay generic and cannot inject messages", async () => {
  const failure = await youtubeBroadcastFailure({
    status: 401,
    json: async () => ({
      error: {
        message: "unsafe access token",
        errors: [{ reason: "Bearer opaque-token" }],
      },
    }),
  });
  assert.match(failure.message, /code : unknown/);
  assert.doesNotMatch(failure.message, /opaque-token|unsafe access token/);
  const nonJson = await youtubeBroadcastFailure({
    status: 503,
    json: async () => {
      throw new Error("bad json");
    },
  });
  assert.match(nonJson.message, /YouTube HTTP 503/);
});

test("YouTube status mapping only publishes real unlisted/public broadcasts", () => {
  const broadcast = (lifeCycleStatus, privacyStatus = "unlisted") => ({
    status: { lifeCycleStatus, privacyStatus },
  });
  assert.equal(publishedStatusFromYouTube(broadcast("ready"), "scheduled"), null);
  assert.equal(publishedStatusFromYouTube(broadcast("testing"), "scheduled"), null);
  assert.equal(publishedStatusFromYouTube(broadcast("live"), "scheduled"), "live");
  assert.equal(publishedStatusFromYouTube(broadcast("complete"), "live"), "replay");
  assert.equal(publishedStatusFromYouTube(broadcast("live", "private"), "scheduled"), null);
  assert.equal(publishedStatusFromYouTube(broadcast("live"), "hidden"), null);
});

test("Club status refresh uses YouTube owner OAuth and updates only club-scoped published rows", async () => {
  const encrypted = encryptRefreshToken(env, "refresh-test-only");
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("pilotoki_live_videos?") && options.method !== "PATCH")
      return {
        ok: true,
        json: async () => [{
          id: "22222222-2222-4222-8222-222222222222",
          youtube_video_id: "abcdefghi12",
          status: "scheduled",
          started_at: null,
        }],
      };
    if (url.includes("pilotoki_live_google_credentials"))
      return {
        ok: true,
        json: async () => [{
          channel_id: "UCAIME5j0y9DdiEQNyttO_jw",
          refresh_token_ciphertext: encrypted.ciphertext,
          refresh_token_iv: encrypted.iv,
        }],
      };
    if (url.includes("oauth2.googleapis.com/token"))
      return { ok: true, json: async () => ({ access_token: "private-oauth-token" }) };
    if (url.includes("youtube/v3/liveBroadcasts"))
      return {
        ok: true,
        json: async () => ({
          items: [{
            id: "abcdefghi12",
            status: { lifeCycleStatus: "complete", privacyStatus: "unlisted" },
          }],
        }),
      };
    if (options.method === "PATCH") return { ok: true };
    throw new Error("Unexpected request");
  };
  const count = await synchronizeClubVideos(
    env, clubId, "UCAIME5j0y9DdiEQNyttO_jw", fetchMock,
  );
  assert.equal(count, 1);
  const patch = calls.find((call) => call.options.method === "PATCH");
  assert.match(patch.url, /club_id=eq\./);
  assert.equal(JSON.parse(patch.options.body).status, "replay");
  assert.equal(patch.options.headers.apikey, "sb_secret_test-only");
  assert.ok(!calls.some((call) => call.url.includes("test-user-token")));
});

test("temporary formatting diagnostic", async () => {
  const prettier = await import("prettier");
  for (const path of [
    "api/_live-youtube-broadcast.mjs",
    "tests/pilotokiLiveBroadcastPreparation.test.mjs",
  ]) {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const formatted = await prettier.format(source, { filepath: path });
    if (path.startsWith("tests/")) {
      const initial = source.split("\\n");
      const final = formatted.split("\\n");
      for (let i = 0; i < Math.max(initial.length, final.length); i++) {
        if (initial[i] !== final[i]) {
          console.log("FMT_TEST_DIFF", JSON.stringify({ line: i, before: initial.slice(i, i + 20), after: final.slice(i, i + 20) }));
          break;
        }
      }
    } else {
      const initial = source.split("\\n");
      const final = formatted.split("\\n");
      for (let i = 0; i < Math.max(initial.length, final.length); i++) {
        if (initial[i] !== final[i]) {
          console.log("FMT_API_DIFF", JSON.stringify({ line: i, before: initial.slice(i, i + 30), after: final.slice(i, i + 30) }));
          break;
        }
      }
    }
  }
});
