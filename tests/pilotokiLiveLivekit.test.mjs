import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { signLivekitPublisherToken } from "../api/_live-livekit.mjs";

test("LiveKit publisher tokens use server-side HS256 signing and have narrow rights", () => {
  const apiKey = "pilotoki-integration-key";
  const secret = "pilotoki-integration-fixture-secret";
  const room = "pilotoki-club-video";
  const now = Date.UTC(2026, 10, 22, 13, 0, 0);
  const token = signLivekitPublisherToken(
    apiKey,
    secret,
    room,
    "pilotoki-camera-user",
    now,
  );
  const [header, claims, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(claims, "base64url"));
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "HS256");
  assert.equal(
    createHmac("sha256", secret)
      .update(`${header}.${claims}`)
      .digest("base64url"),
    signature,
  );
  assert.equal(payload.iss, apiKey);
  assert.equal(payload.video.room, room);
  assert.equal(payload.video.roomJoin, true);
  assert.equal(payload.video.canPublish, true);
  assert.equal(payload.video.canSubscribe, false);
  assert.equal(payload.video.roomAdmin, false);
  assert.equal(payload.video.roomCreate, false);
  assert.equal(payload.exp - payload.iat, 600);
  assert.doesNotMatch(token, /pilotoki-integration-fixture-secret/);
});

test("LiveKit token API is guarded by club admin and video membership checks", () => {
  const service = readFileSync(
    new URL("../api/_live-livekit.mjs", import.meta.url),
    "utf8",
  );
  const endpoint = readFileSync(
    new URL("../api/live-youtube-ingest.mjs", import.meta.url),
    "utf8",
  );
  assert.match(service, /verifiedLiveClubAdmin/);
  assert.match(service, /getClubVideo/);
  assert.match(service, /canConnectGoogle/);
  assert.match(service, /LIVEKIT_API_SECRET/);
  assert.match(endpoint, /livekit_publisher_token/);
  assert.doesNotMatch(service, /UPSTREAM_API_TOKEN/);
});

test("Mobile publisher tags raw tracks so participant egress captures camera", () => {
  const source = readFileSync(
    new URL("../src/features/admin/live/pages/PilotokiLiveLivekitCameraPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /source: Track\.Source\.Camera/);
  assert.match(source, /source: Track\.Source\.Microphone/);
  assert.match(source, /getTrackPublication\(\s*Track\.Source\.Camera/);
  assert.match(source, /videoTrack\.readyState !== "live"/);
  assert.doesNotMatch(source, /publishTrack\(track\)/);
});
