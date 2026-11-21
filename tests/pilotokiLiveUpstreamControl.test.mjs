import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  inspectUpstreamControl,
  controlUpstreamStream,
  publicControlStatus,
} from "../api/_live-upstream-control.mjs";

const club = "188029a8-3e6a-41cd-821f-01984a703552";
const videoId = "11111111-1111-4111-8111-111111111111";
const streamId = "22222222-2222-4222-8222-222222222222";
const destinationId = "33333333-3333-4333-8333-333333333333";
const youtubeId = "AbCdEfGh123";
const env = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
  UPSTREAM_API_TOKEN: "readonly-secret",
  UPSTREAM_API_FULL_TOKEN: "write-secret",
};

function mock({ platform = "none", streamStatus = "paused", targetStatus = "paused", other = [] } = {}) {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("pilotoki_live_videos?"))
      return { ok: true, json: async () => [{ id: videoId, youtube_video_id: youtubeId, title: "Test Pilotoki", status: "scheduled" }] };
    if (url.includes("pilotoki_live_upstream_bindings?"))
      return { ok: true, json: async () => [{ upstream_stream_id: streamId, upstream_destination_id: destinationId }] };
    if (url.endsWith("/destinations"))
      return { ok: true, json: async () => ({ data: [{ id: destinationId, url: youtubeId, platform: "custom", status: targetStatus }, ...other] }) };
    if (url.endsWith(streamId))
      return { ok: true, json: async () => ({ data: { id: streamId, platform, status: streamStatus } }) };
    if (options.method === "PATCH" || options.method === "POST")
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    throw new Error("unknown endpoint");
  };
  return { fetchMock, calls };
}

test("The old YouTube-primary stream cannot start, even with linked destination", async () => {
  const { fetchMock, calls } = mock({ platform: "youtube" });
  const audit = await inspectUpstreamControl(env, club, videoId, fetchMock);
  assert.equal(audit.safe, false);
  assert.equal(audit.canStart, false);
  assert.match(audit.reason, /destination principale/);
  await assert.rejects(controlUpstreamStream(env, club, videoId, "start", fetchMock), /destination principale/);
  assert.equal(calls.filter(x => ["POST", "PATCH"].includes(x.options.method)).length, 0);
});

test("Other active destinations block any start command", async () => {
  const { fetchMock, calls } = mock({
    other: [{ id: "44444444-4444-4444-8444-444444444444", status: "active" }],
  });
  await assert.rejects(controlUpstreamStream(env, club, videoId, "start", fetchMock), /autre destination/);
  assert.equal(calls.filter(x => ["POST", "PATCH"].includes(x.options.method)).length, 0);
});

test("Only mapped destination is enabled before starting a primary-free stream", async () => {
  const { fetchMock, calls } = mock();
  const result = await controlUpstreamStream(env, club, videoId, "start", fetchMock);
  assert.deepEqual(result, { action: "start", requested: true });
  const commands = calls.filter(x => ["POST", "PATCH"].includes(x.options.method));
  assert.equal(commands.length, 2);
  assert.match(commands[0].url, new RegExp(destinationId));
  assert.deepEqual(JSON.parse(commands[0].options.body), { status: "active" });
  assert.match(commands[1].url, /\/start$/);
  assert.equal(commands[0].options.headers.Authorization, "Bearer write-secret");
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test("Stops only a stream with its matched destination active", async () => {
  const { fetchMock, calls } = mock({ streamStatus: "active", targetStatus: "active" });
  await controlUpstreamStream(env, club, videoId, "stop", fetchMock);
  const commands = calls.filter(x => ["POST", "PATCH"].includes(x.options.method));
  assert.match(commands[0].url, /\/stop$/);
  assert.deepEqual(JSON.parse(commands[1].options.body), { status: "paused" });
});

test("Public status omits identifying keys and internal binding", async () => {
  const { fetchMock } = mock();
  const status = publicControlStatus(await inspectUpstreamControl(env, club, videoId, fetchMock));
  assert.deepEqual(status, {
    safe: true, reason: null, streamStatus: "paused",
    destinationStatus: "paused", canStart: true, canStop: false,
  });
  assert.doesNotMatch(JSON.stringify(status), /secret|youtubeId|streamId/);
});

test("Only admin pilot with explicit approval can issue stream controls", () => {
  const route = readFileSync(new URL("../api/live-youtube-ingest.mjs", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/features/admin/live/components/PilotokiLiveLaunchAssistant.tsx", import.meta.url), "utf8");
  assert.match(route, /request\.body\?\.action === "control_upstream"/);
  assert.match(route, /if \(!canConnectGoogle\)/);
  assert.match(route, /request\.body\?\.confirmed !== true/);
  assert.match(ui, /confirmedControl/);
  assert.match(ui, /Démarrer Upstream/);
  assert.match(ui, /Arrêter Upstream/);
  assert.doesNotMatch(ui, /UPSTREAM_API_FULL_TOKEN/);
});
