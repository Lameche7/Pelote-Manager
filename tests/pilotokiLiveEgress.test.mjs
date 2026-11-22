import assert from "node:assert/strict";
import { test } from "node:test";
import { createCipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  livekitRoom,
  livekitEgressStatus,
  startLivekitEgress,
  abortLivekitEgress,
} from "../api/_live-livekit-egress.mjs";

const club = "188029a8-3e6a-41cd-821f-01984a703552";
const video = {
  id: "22222222-2222-4222-8222-222222222222",
  youtube_video_id: "AbCdEfGh123",
  status: "scheduled",
};
const room = livekitRoom(club, video.id);
const identity = "pilotoki-camera-33333333-3333-4333-8333-333333333333";
const encryptKey = Buffer.alloc(32, 7);
const iv = Buffer.alloc(12, 3);
const cipher = createCipheriv("aes-256-gcm", encryptKey, iv);
const encrypted = Buffer.concat([
  cipher.update(
    JSON.stringify({
      address: "rtmps://a.rtmps.youtube.com/live2",
      streamName: "mock-secret-youtube-key",
    }),
  ),
  cipher.final(),
  cipher.getAuthTag(),
]);
const env = {
  LIVEKIT_URL: "wss://livekit.example.cloud",
  LIVEKIT_API_KEY: "livekit-test-key",
  LIVEKIT_API_SECRET: "livekit-test-secret",
  VITE_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
  YOUTUBE_TOKEN_ENCRYPTION_KEY: encryptKey.toString("base64"),
};

function mockedMedia({ existing = [], startStatus = 1 } = {}) {
  const calls = [];
  const mock = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/twirp/livekit.Egress/ListEgress"))
      return { ok: true, json: async () => ({ items: existing }) };
    if (String(url).includes("/pilotoki_live_ingest_credentials?"))
      return {
        ok: true,
        json: async () => [
          {
            youtube_stream_id: "stream-test",
            ingest_ciphertext: encrypted.toString("base64"),
            ingest_iv: iv.toString("base64"),
          },
        ],
      };
    if (String(url).endsWith("/twirp/livekit.Egress/StartEgress"))
      return {
        ok: true,
        json: async () => ({
          roomName: room,
          egressId: "egress-test",
          status: startStatus,
        }),
      };
    if (String(url).endsWith("/twirp/livekit.Egress/StopEgress"))
      return {
        ok: true,
        json: async () => ({ egressId: "egress-test", status: 3 }),
      };
    if (String(url).includes("/pilotoki_live_videos?"))
      return { ok: true, json: async () => [video] };
    throw new Error("Unexpected mock request " + url);
  };
  return { mock, calls };
}

test("LiveKit Egress sends only the authorized room and YouTube RTMPS output", async () => {
  const { mock, calls } = mockedMedia();
  const result = await startLivekitEgress(env, club, video, identity, mock);
  assert.equal(result.started, true);
  const start = calls.find((call) => call.url.endsWith("/StartEgress"));
  assert.ok(start);
  const body = JSON.parse(start.options.body);
  assert.equal(body.roomName, room);
  assert.equal(body.media.participantVideo.identity, identity);
  assert.equal(body.media.audio.routes[0].participantIdentity, identity);
  assert.deepEqual(body.outputs[0].stream.urls, [
    "rtmps://a.rtmps.youtube.com/live2/mock-secret-youtube-key",
  ]);
  const signedToken = start.options.headers.Authorization.split(" ")[1];
  const claims = JSON.parse(
    Buffer.from(signedToken.split(".")[1], "base64url"),
  );
  assert.equal(claims.video.roomRecord, true);
  assert.doesNotMatch(JSON.stringify(result), /mock-secret-youtube-key/);
});

test("Existing active Egress blocks a second stream without accessing YouTube credentials", async () => {
  const { mock, calls } = mockedMedia({
    existing: [{ roomName: room, egressId: "egress-test", status: 1 }],
  });
  await assert.rejects(
    startLivekitEgress(env, club, video, identity, mock),
    /déjà/,
  );
  assert.equal(
    calls.some((call) => call.url.endsWith("/StartEgress")),
    false,
  );
});

test("LiveKit status supports protobuf empty lists and filters to one club room", async () => {
  const { mock } = mockedMedia({
    existing: [
      { roomName: room, egressId: "egress-test", status: 1 },
      {
        roomName: "pilotoki-other-club-other-video",
        egressId: "other",
        status: 1,
      },
    ],
  });
  assert.deepEqual(await livekitEgressStatus(env, club, video.id, mock), {
    active: true,
    starting: false,
    count: 1,
  });
  const noEgress = async () => ({ ok: true, json: async () => ({}) });
  assert.deepEqual(await livekitEgressStatus(env, club, video.id, noEgress), {
    active: false,
    starting: false,
    count: 0,
  });
});

test("Abort only stops the egress associated with verified video and room", async () => {
  const { mock, calls } = mockedMedia({
    existing: [{ roomName: room, egressId: "egress-test", status: 1 }],
  });
  const stopped = await abortLivekitEgress(env, club, video.id, mock);
  assert.deepEqual(stopped, { stopped: true });
  const stop = calls.find((call) => call.url.endsWith("/StopEgress"));
  assert.deepEqual(JSON.parse(stop.options.body), { egressId: "egress-test" });
});

test("LiveKit and YouTube actions remain restricted to a confirmed administrator", () => {
  const endpoint = readFileSync(
    new URL("../api/live-youtube-ingest.mjs", import.meta.url),
    "utf8",
  );
  assert.match(endpoint, /verifiedLiveClubAdmin/);
  assert.match(endpoint, /canConnectGoogle/);
  assert.match(endpoint, /livekit_egress_start/);
  assert.match(endpoint, /livekit_youtube_publish/);
  assert.match(endpoint, /livekit_youtube_finish/);
  assert.match(endpoint, /confirmed !== true/);
});
