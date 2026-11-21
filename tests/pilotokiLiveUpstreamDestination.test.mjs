import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { encryptIngestCredentials } from "../api/_live-youtube-ingest.mjs";
import { decryptYoutubeIngest, prepareUpstreamYoutubeDestination } from "../api/_live-upstream-destination.mjs";

const video = {
  id: "11111111-1111-4111-8111-111111111111",
  youtube_video_id: "AbCdEfGh123",
  title: "Test Pilotoki",
  status: "scheduled",
};
const club = "188029a8-3e6a-41cd-821f-01984a703552";
const stream = "22222222-2222-4222-8222-222222222222";
const destination = "33333333-3333-4333-8333-333333333333";
const env = {
  VITE_SUPABASE_URL: "https://fake.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
  UPSTREAM_API_TOKEN: "read-only-secret",
  UPSTREAM_API_FULL_TOKEN: "write-secret",
  YOUTUBE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const ingest = encryptIngestCredentials(env, {
  address: "rtmps://a.rtmps.youtube.com/live2",
  streamName: "abcd-efgh-ijkl",
});
const fakeIngest = { ingest_ciphertext: ingest.ciphertext, ingest_iv: ingest.iv };

test("Decrypts known YouTube credentials strictly on the server", () => {
  assert.equal(
    decryptYoutubeIngest(env, fakeIngest),
    "rtmps://a.rtmps.youtube.com/live2/abcd-efgh-ijkl",
  );
  const malicious = encryptIngestCredentials(env, {
    address: "rtmps://another-host.example/live2",
    streamName: "abcd-efgh",
  });
  assert.throws(
    () => decryptYoutubeIngest(env, {
      ingest_ciphertext: malicious.ciphertext,
      ingest_iv: malicious.iv,
    }),
    /invalides/,
  );
});

function fakeFetch(destinations = [], bindingDestination = null) {
  const calls = [];
  const mock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/rest/v1/pilotoki_live_upstream_bindings")) {
      if (options.method === "PATCH")
        return { ok: true, json: async () => [{ video_id: video.id }] };
      return {
        ok: true,
        json: async () => [{
          upstream_stream_id: stream,
          upstream_destination_id: bindingDestination,
        }],
      };
    }
    if (url.includes("/rest/v1/pilotoki_live_ingest_credentials"))
      return { ok: true, json: async () => [fakeIngest] };
    if (url.endsWith("/destinations") && options.method === "GET")
      return { ok: true, json: async () => ({ data: destinations }) };
    if (url.endsWith("/destinations") && options.method === "POST")
      return {
        ok: true,
        status: 201,
        json: async () => ({ data: { id: destination, status: "paused" } }),
      };
    if (url.includes("studio.upstream.so/api/v1/streams/"))
      return {
        ok: true,
        json: async () => ({ data: { id: stream, status: "paused" } }),
      };
    throw new Error("unexpected URL: " + url);
  };
  return { mock, calls };
}

test("Creates paused RTMPS destination with credentials only via protected server API", async () => {
  const { mock, calls } = fakeFetch();
  const result = await prepareUpstreamYoutubeDestination(env, club, video, mock);
  assert.deepEqual(result, { configured: true, alreadyConfigured: false });
  const post = calls.find((entry) => entry.options.method === "POST");
  const sent = JSON.parse(post.options.body);
  assert.equal(sent.platform, "custom");
  assert.equal(sent.status, "paused");
  assert.equal(sent.include_in_schedule, false);
  assert.equal(sent.url, video.youtube_video_id);
  assert.equal(sent.key, "rtmps://a.rtmps.youtube.com/live2/abcd-efgh-ijkl");
  assert.equal(post.options.headers.Authorization, "Bearer write-secret");
  const saved = calls.find((entry) => entry.options.method === "PATCH");
  assert.deepEqual(JSON.parse(saved.options.body), {
    upstream_destination_id: destination,
  });
  assert.doesNotMatch(saved.options.body, /abcd-efgh|write-secret/);
  assert.doesNotMatch(JSON.stringify(result), /abcd-efgh|write-secret/);
  assert.equal(calls.filter((entry) => entry.options.method === "POST").length, 1);
});

test("Existing destination is idempotent and never overwritten", async () => {
  const { mock, calls } = fakeFetch(
    [{ id: destination, url: video.youtube_video_id, status: "paused" }],
    destination,
  );
  assert.deepEqual(
    await prepareUpstreamYoutubeDestination(env, club, video, mock),
    { configured: true, alreadyConfigured: true },
  );
  assert.equal(calls.filter((entry) => entry.options.method === "POST").length, 0);
});

test("Unexpected destination with same YouTube ID blocks a second creation", async () => {
  const { mock, calls } = fakeFetch([
    { id: destination, url: video.youtube_video_id, status: "paused" },
  ]);
  await assert.rejects(
    prepareUpstreamYoutubeDestination(env, club, video, mock),
    /existe déjà/,
  );
  assert.equal(calls.filter((entry) => entry.options.method === "POST").length, 0);
});

test("Never modifies destinations on a running stream", async () => {
  const { mock, calls } = fakeFetch();
  const running = async (url, opts) => {
    if (url.includes("studio.upstream.so/api/v1/streams/") && !url.endsWith("/destinations"))
      return { ok: true, json: async () => ({ data: { id: stream, status: "active" } }) };
    return mock(url, opts);
  };
  await assert.rejects(
    prepareUpstreamYoutubeDestination(env, club, video, running),
    /Arrêtez d'abord/,
  );
  assert.equal(calls.filter((entry) => entry.options.method === "POST").length, 0);
});

test("Handler requires pilot admin and positive confirmation before any write", () => {
  const api = readFileSync(new URL("../api/live-youtube-ingest.mjs", import.meta.url), "utf8");
  assert.match(api, /request\.body\?\.action === "prepare_upstream_destination"/);
  assert.match(api, /if \(!canConnectGoogle\)/);
  assert.match(api, /request\.body\?\.confirmed !== true/);
  const ui = readFileSync(new URL("../src/features/admin/live/components/PilotokiLiveLaunchAssistant.tsx", import.meta.url), "utf8");
  assert.match(ui, /Préparer automatiquement la destination YouTube/);
  assert.match(ui, /confirmedPreparation/);
  assert.doesNotMatch(ui, /UPSTREAM_API_FULL_TOKEN|rtmps:\/\//);
});
