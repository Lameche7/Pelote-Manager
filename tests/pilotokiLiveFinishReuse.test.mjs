import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { encryptIngestCredentials } from "../api/_live-youtube-ingest.mjs";
import {
  completeVerifiedYoutubeLive,
  assertYoutubeBroadcastComplete,
} from "../api/_live-youtube-publish.mjs";
import { reuseIdleUpstreamForVideo } from "../api/_live-upstream-reuse.mjs";

const clubId = "188029a8-3e6a-41cd-821f-01984a703552";
const upstreamId = "33333333-3333-4333-8333-333333333333";
const oldVideoId = "11111111-1111-4111-8111-111111111111";
const newVideoId = "22222222-2222-4222-8222-222222222222";
const video = {
  id: newVideoId,
  youtube_video_id: "NewVideo123",
  status: "scheduled",
};
const env = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
  UPSTREAM_API_TOKEN: "read-only",
  UPSTREAM_API_FULL_TOKEN: "write-only",
  YOUTUBE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const encrypted = encryptIngestCredentials(env, {
  address: "rtmps://a.rtmps.youtube.com/live2",
  streamName: "new-youtube-key",
});

test("YouTube completion only affects the exact bound live broadcast", async () => {
  const calls = [];
  const mock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/liveBroadcasts?"))
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "OldVideo123",
              contentDetails: { boundStreamId: "YTStreamId1" },
              status: { lifeCycleStatus: "live" },
            },
          ],
        }),
      };
    if (url.includes("/transition?"))
      return {
        ok: true,
        json: async () => ({
          id: "OldVideo123",
          status: { lifeCycleStatus: "complete" },
        }),
      };
    throw new Error("Unexpected request");
  };
  assert.deepEqual(
    await completeVerifiedYoutubeLive(
      "oauth-secret",
      "OldVideo123",
      "YTStreamId1",
      mock,
    ),
    { status: "complete", alreadyComplete: false },
  );
  assert.equal(
    calls.filter((call) => call.options.method === "POST").length,
    1,
  );
  assert.match(calls.at(-1).url, /broadcastStatus=complete/);
});

test("Incorrect YouTube stream cannot be completed", async () => {
  const requests = [];
  const mock = async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        items: [
          {
            id: "OldVideo123",
            contentDetails: { boundStreamId: "AnotherStream" },
            status: { lifeCycleStatus: "live" },
          },
        ],
      }),
    };
  };
  await assert.rejects(
    completeVerifiedYoutubeLive("token", "OldVideo123", "YTStreamId1", mock),
    /ne correspond pas/,
  );
  assert.equal(
    requests.some((call) => call.options.method === "POST"),
    false,
  );
});

function reuseFetch({
  upstreamStatus = "paused",
  youtubeComplete = true,
} = {}) {
  const calls = [];
  const state = {
    id: upstreamId,
    status: upstreamStatus,
    platform: "youtube",
    url: "OldVideo123",
  };
  const mock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("pilotoki_live_upstream_bindings")) {
      if (options.method === "PATCH")
        return {
          ok: true,
          json: async () => [{ video_id: newVideoId }],
        };
      return {
        ok: true,
        json: async () => [
          {
            video_id: oldVideoId,
            upstream_stream_id: upstreamId,
            upstream_destination_id: upstreamId,
          },
        ],
      };
    }
    if (url.includes("pilotoki_live_videos"))
      return {
        ok: true,
        json: async () => [
          {
            id: oldVideoId,
            youtube_video_id: "OldVideo123",
          },
        ],
      };
    if (url.includes("/liveBroadcasts?"))
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "OldVideo123",
              status: {
                lifeCycleStatus: youtubeComplete ? "complete" : "live",
              },
            },
          ],
        }),
      };
    if (url.includes("/pilotoki_live_ingest_credentials"))
      return {
        ok: true,
        json: async () => [
          {
            youtube_stream_id: "YTstream",
            ingest_ciphertext: encrypted.ciphertext,
            ingest_iv: encrypted.iv,
          },
        ],
      };
    if (url.endsWith("/destinations"))
      return { ok: true, json: async () => ({ data: [] }) };
    if (url.endsWith(upstreamId) && options.method === "PATCH") {
      const payload = JSON.parse(options.body);
      state.url = payload.url;
      return { ok: true, status: 200 };
    }
    if (url.endsWith(upstreamId))
      return { ok: true, json: async () => ({ data: state }) };
    throw new Error("Unexpected request");
  };
  return { mock, calls };
}

test("Reuses only an idle studio after archive, without starting live", async () => {
  const { mock, calls } = reuseFetch();
  assert.deepEqual(
    await reuseIdleUpstreamForVideo(env, clubId, video, "youtube-token", mock),
    { configured: true, reused: true },
  );
  const upstreamPatch = calls.find(
    (call) => call.url.endsWith(upstreamId) && call.options.method === "PATCH",
  );
  assert.deepEqual(JSON.parse(upstreamPatch.options.body), {
    platform: "youtube",
    key: "new-youtube-key",
    url: "NewVideo123",
  });
  assert.equal(
    calls.filter((call) => call.options.method === "POST").length,
    0,
  );
  const save = calls.find(
    (call) =>
      call.url.includes("pilotoki_live_upstream_bindings") &&
      call.options.method === "PATCH",
  );
  assert.deepEqual(JSON.parse(save.options.body), {
    video_id: newVideoId,
  });
  assert.doesNotMatch(save.options.body, /new-youtube-key|youtube-token/);
});

test("Refuses re-use when old YouTube broadcast has not ended", async () => {
  const { mock, calls } = reuseFetch({ youtubeComplete: false });
  await assert.rejects(
    reuseIdleUpstreamForVideo(env, clubId, video, "youtube-token", mock),
    /Terminez d'abord/,
  );
  assert.equal(
    calls.some((call) => call.options.method === "PATCH"),
    false,
  );
});

test("Refuses re-use when studio is running", async () => {
  const { mock, calls } = reuseFetch({ upstreamStatus: "active" });
  await assert.rejects(
    reuseIdleUpstreamForVideo(env, clubId, video, "youtube-token", mock),
    /Arrêtez d'abord/,
  );
  assert.equal(
    calls.some((call) => call.options.method === "PATCH"),
    false,
  );
});

test("Only an explicit authorized Pilotoki admin can rotate or complete", () => {
  const api = readFileSync(
    new URL("../api/live-youtube-ingest.mjs", import.meta.url),
    "utf8",
  );
  assert.match(api, /action === "reuse_upstream"/);
  assert.match(api, /action === "finish_youtube"/);
  assert.match(api, /request\.body\?\.confirmed !== true/);
  assert.match(api, /if \(!canConnectGoogle\)/);
  assert.match(api, /completeVerifiedYoutubeLive/);
  const ui = readFileSync(
    new URL(
      "../src/features/admin/live/components/PilotokiLiveLaunchAssistant.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(ui, /Terminer ce direct et conserver le replay/);
  assert.match(ui, /Réutiliser la régie après la partie précédente/);
});
