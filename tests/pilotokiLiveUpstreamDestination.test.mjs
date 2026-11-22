import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { encryptIngestCredentials } from "../api/_live-youtube-ingest.mjs";
import {
  decryptYoutubeIngest,
  prepareUpstreamYoutubeDestination,
} from "../api/_live-upstream-destination.mjs";

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
const fakeIngest = {
  ingest_ciphertext: ingest.ciphertext,
  ingest_iv: ingest.iv,
};

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
    () =>
      decryptYoutubeIngest(env, {
        ingest_ciphertext: malicious.ciphertext,
        ingest_iv: malicious.iv,
      }),
    /invalides/,
  );
});

function fakeFetch({
  primaryPlatform = "none",
  primaryUrl = null,
  primaryStatus = "paused",
  destinations = [],
  boundDestinationId = null,
  patchStatus = 200,
} = {}) {
  const calls = [];
  const state = {
    id: stream,
    status: primaryStatus,
    platform: primaryPlatform,
    url: primaryUrl,
  };
  const mock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/rest/v1/pilotoki_live_upstream_bindings")) {
      if (options.method === "PATCH")
        return { ok: true, json: async () => [{ video_id: video.id }] };
      return {
        ok: true,
        json: async () => [
          {
            upstream_stream_id: stream,
            upstream_destination_id: boundDestinationId,
          },
        ],
      };
    }
    if (url.includes("/rest/v1/pilotoki_live_ingest_credentials"))
      return { ok: true, json: async () => [fakeIngest] };
    if (url.endsWith("/destinations") && options.method === "GET")
      return { ok: true, json: async () => ({ data: destinations }) };
    if (url.endsWith(stream) && options.method === "PATCH") {
      if (patchStatus !== 200) return { ok: false, status: patchStatus };
      const update = JSON.parse(options.body);
      state.platform = update.platform;
      state.url = update.url;
      return { ok: true, status: 200, json: async () => ({ data: state }) };
    }
    if (url.endsWith(stream) && !options.method)
      return { ok: true, json: async () => ({ data: state }) };
    throw new Error("unexpected URL: " + url);
  };
  return { mock, calls };
}

test("Configures a dedicated paused stream primary, without multistream or starting", async () => {
  const { mock, calls } = fakeFetch();
  assert.deepEqual(
    await prepareUpstreamYoutubeDestination(env, club, video, mock),
    { configured: true, alreadyConfigured: false },
  );
  const providerPatch = calls.find(
    (call) =>
      call.url.endsWith(stream) && call.options.method === "PATCH",
  );
  assert.deepEqual(JSON.parse(providerPatch.options.body), {
    platform: "youtube",
    key: "abcd-efgh-ijkl",
    url: video.youtube_video_id,
  });
  assert.equal(
    providerPatch.options.headers.Authorization,
    "Bearer write-secret",
  );
  const saved = calls.find(
    (call) =>
      call.url.includes("pilotoki_live_upstream_bindings") &&
      call.options.method === "PATCH",
  );
  assert.deepEqual(JSON.parse(saved.options.body), {
    upstream_destination_id: stream,
  });
  assert.doesNotMatch(saved.options.body, /abcd-efgh|write-secret/);
  assert.equal(calls.some((call) => call.options.method === "POST"), false);
});

test("Verified primary binding is idempotent and never rewrites a key", async () => {
  const { mock, calls } = fakeFetch({
    primaryPlatform: "youtube",
    primaryUrl: video.youtube_video_id,
    boundDestinationId: stream,
  });
  assert.deepEqual(
    await prepareUpstreamYoutubeDestination(env, club, video, mock),
    { configured: true, alreadyConfigured: true },
  );
  assert.equal(calls.some((call) => call.options.method === "PATCH"), false);
});

test("Existing primary or secondary is never overwritten", async () => {
  for (const setup of [
    { primaryPlatform: "youtube", primaryUrl: "OtherVideo1" },
    { destinations: [{ id: destination, status: "paused" }] },
  ]) {
    const { mock, calls } = fakeFetch(setup);
    await assert.rejects(
      prepareUpstreamYoutubeDestination(env, club, video, mock),
      /régie possède déjà une destination/,
    );
    assert.equal(calls.some((call) => call.options.method === "PATCH"), false);
  }
});

test("Changing primary YouTube identity after binding blocks preparation", async () => {
  const { mock } = fakeFetch({
    primaryPlatform: "youtube",
    primaryUrl: "OtherVideo1",
    boundDestinationId: stream,
  });
  await assert.rejects(
    prepareUpstreamYoutubeDestination(env, club, video, mock),
    /a changé/,
  );
});

test("An active stream is never changed", async () => {
  const { mock, calls } = fakeFetch({ primaryStatus: "active" });
  await assert.rejects(
    prepareUpstreamYoutubeDestination(env, club, video, mock),
    /Arrêtez d'abord/,
  );
  assert.equal(calls.some((call) => call.options.method === "PATCH"), false);
});

test("Provider PATCH failure is reported without leaking stream keys", async () => {
  const { mock } = fakeFetch({ patchStatus: 422 });
  await assert.rejects(
    prepareUpstreamYoutubeDestination(env, club, video, mock),
    (error) => {
      assert.match(error.message, /HTTP 422/);
      assert.doesNotMatch(error.message, /abcd-efgh|write-secret/);
      return true;
    },
  );
});

test("Handler requires pilot admin and confirmation", () => {
  const api = readFileSync(
    new URL("../api/live-youtube-ingest.mjs", import.meta.url),
    "utf8",
  );
  assert.match(api, /request\.body\?\.action === "prepare_upstream_destination"/);
  assert.match(api, /if \(!canConnectGoogle\)/);
  assert.match(api, /request\.body\?\.confirmed !== true/);
});
