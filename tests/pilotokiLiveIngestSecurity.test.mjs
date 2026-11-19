import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  encryptIngestCredentials,
  existingIngest,
  getClubVideo,
  youtubeCreateIngest,
  youtubeBindIngest,
  saveIngest,
} from "../api/_live-youtube-ingest.mjs";
import { LiveAuthError } from "../api/_live-google-shared.mjs";

const env = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example",
  YOUTUBE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};
const clubId = "188029a8-3e6a-41cd-821f-01984a703552";
const videoId = "22222222-2222-4222-8222-222222222222";

test("RTMPS destination and stream name are encrypted, never plaintext", () => {
  const address = "rtmps://a.rtmps.youtube.com/live2";
  const streamName = "secret-key-just-for-unit-tests";
  const sealed = encryptIngestCredentials(env, { address, streamName });
  assert.ok(sealed.iv && sealed.ciphertext);
  assert.doesNotMatch(JSON.stringify(sealed), /secret-key-just-for-unit-tests/);
  assert.doesNotMatch(JSON.stringify(sealed), /a.rtmps.youtube.com/);
});

test("YouTube ingest requires RTMPS and rejects insecure ingestion URLs", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      id: "stream-test-identifier",
      cdn: { ingestionInfo: { rtmpsIngestionAddress: "rtmp://insecure", streamName: "key" } },
    }),
  });
  await assert.rejects(youtubeCreateIngest("test-access", "Pilotoki", fakeFetch), LiveAuthError);
});

test("The YouTube liveStream is explicitly bound to the prepared broadcast", async () => {
  let request;
  await youtubeBindIngest("token", "abcdefghijk", "stream987", async (url, options) => {
    request = { url, options };
    return { ok: true };
  });
  assert.match(request.url, /liveBroadcasts\/bind/);
  assert.match(request.url, /id=abcdefghijk/);
  assert.match(request.url, /streamId=stream987/);
});

test("Club scope is part of every video lookup before an ingest can be created", async () => {
  let requested;
  const video = await getClubVideo(env, clubId, videoId, async (url) => {
    requested = url;
    return {
      ok: true,
      json: async () => [{
        id: videoId, club_id: clubId, youtube_video_id: "abcdefghijk",
        title: "Pilotoki test", status: "scheduled",
      }],
    };
  });
  assert.equal(video.id, videoId);
  assert.match(requested, /club_id=eq\./);
  await assert.rejects(
    getClubVideo(env, clubId, videoId, async () => ({ ok: true, json: async () => [] })),
    (error) => error instanceof LiveAuthError && error.status === 404,
  );
});

test("Existing ingest is checked without revealing its credentials", async () => {
  const ready = await existingIngest(env, videoId, async (url) => {
    assert.match(url, /select=video_id/);
    return { ok: true, json: async () => [{ video_id: videoId }] };
  });
  assert.equal(ready, true);
});

test("Only encrypted ingestion information is stored in Supabase", async () => {
  let stored;
  await saveIngest(env, videoId, "stream987", {
    ciphertext: "base64-sealed-test",
    iv: "base64-iv-test",
  }, async (_url, options) => {
    stored = JSON.parse(options.body);
    return { ok: true };
  });
  assert.deepEqual(Object.keys(stored).sort(),
    ["video_id", "youtube_stream_id", "ingest_ciphertext", "ingest_iv"].sort());
  assert.equal(stored.video_id, videoId);
  assert.equal(stored.ingest_ciphertext, "base64-sealed-test");
});
