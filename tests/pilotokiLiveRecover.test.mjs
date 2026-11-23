import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { recoverMissingYoutubeBroadcast } from "../api/_live-youtube-recover.mjs";

const clubId = "188029a8-3e6a-41cd-821f-01984a703552";
const videoId = "80c76308-c82e-4665-97f6-1c113b64dffe";
const matchId = "2ebae357-460d-469c-8370-36c12c46ed15";
const resourceId = "33333333-3333-4333-8333-333333333333";
const oldYoutubeId = "7WdmbnFc3DI";
const newYoutubeId = "X53wcqCE9cY";
const slot = {
  resourceId,
  startsAt: "2026-11-23T17:00:00+01:00",
  endsAt: "2026-11-23T18:00:00+01:00",
};
const env = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "public-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};
const request = (extra = {}) => ({
  headers: { authorization: "Bearer user-token" },
  body: { videoId, calendarSlot: slot, consentConfirmed: true, ...extra },
});
function response(body, ok = true) {
  return { ok, json: async () => body };
}
function fixture({ youtubeItems = [], matchCorrect = true, active = false } = {}) {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    const value = String(url);
    const method = options.method ?? "GET";
    calls.push({ url: value, method, body: options.body });
    if (value.includes("/rest/v1/pilotoki_live_videos?") && method === "GET") {
      const params = new URL(value).searchParams;
      if (params.get("select") === "id,club_id,youtube_video_id,title,status")
        return response([{
          id: videoId, club_id: clubId, youtube_video_id: oldYoutubeId,
          title: "Partie de championnat", status: "scheduled",
        }]);
      return response(matchCorrect ? [{ id: videoId }] : []);
    }
    if (value.includes("/reservable_resources?"))
      return response([{ id: resourceId }]);
    if (value.includes("/rpc/resolve_calendar_competition"))
      return response({ kind: "tournament", matchId });
    if (value.includes("www.googleapis.com/youtube/v3/liveBroadcasts?") && method === "POST")
      return response({ id: newYoutubeId });
    if (value.includes("www.googleapis.com/youtube/v3/liveBroadcasts?"))
      return response({ items: youtubeItems });
    if (value.includes("/pilotoki_live_ingest_credentials?"))
      return response(null);
    if (value.includes("/pilotoki_live_videos?") && method === "PATCH")
      return response([{ id: videoId }]);
    throw new Error("Unexpected fetch: " + method + " " + value);
  };
  const run = (extra = {}) =>
    recoverMissingYoutubeBroadcast(
      env, request(extra), clubId, "UC123", fetchMock,
      async () => ({ active }), async () => "google-token",
    );
  return { run, calls };
}

test("Existing verified YouTube event is preserved without any mutation", async () => {
  const f = fixture({
    youtubeItems: [{ id: oldYoutubeId, status: { lifeCycleStatus: "ready" } }],
  });
  assert.deepEqual(await f.run(), {
    recovered: false,
    videoId,
    youtubeUrl: "https://www.youtube.com/watch?v=" + oldYoutubeId,
  });
  assert.ok(f.calls.every((call) => !["DELETE", "PATCH", "POST"].includes(call.method)
    || call.url.includes("/rpc/resolve_calendar_competition")));
});

test("Deleted event first requests explicit children classification", async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), {
    requiresClassification: true,
    videoId,
  });
  assert.equal(f.calls.filter((c) => c.method === "DELETE").length, 0);
});

test("Repair preserves internal ID and match and rotates old RTMPS credentials", async () => {
  const f = fixture();
  const result = await f.run({ madeForKids: false });
  assert.equal(result.recovered, true);
  assert.equal(result.videoId, videoId);
  assert.ok(result.youtubeUrl.endsWith(newYoutubeId));
  const deletion = f.calls.find((c) => c.method === "DELETE");
  const creation = f.calls.find((c) => c.method === "POST" && c.url.includes("googleapis.com"));
  const patch = f.calls.find((c) => c.method === "PATCH");
  assert.ok(deletion && creation && patch);
  assert.ok(f.calls.indexOf(deletion) < f.calls.indexOf(creation));
  assert.ok(f.calls.indexOf(creation) < f.calls.indexOf(patch));
  assert.equal(JSON.parse(patch.body).youtube_video_id, newYoutubeId);
  assert.equal(JSON.parse(patch.body).source_id, undefined);
  assert.equal(new URL(patch.url).searchParams.get("source_id"), "eq." + matchId);
  assert.equal(new URL(patch.url).searchParams.get("youtube_video_id"), "eq." + oldYoutubeId);
});

test("Wrong match or active egress prevents replacement", async () => {
  const wrong = fixture({ matchCorrect: false });
  await assert.rejects(wrong.run({ madeForKids: false }), /liée à la partie/);
  assert.ok(!wrong.calls.some((c) => c.method === "DELETE"));
  const active = fixture({ active: true });
  await assert.rejects(active.run({ madeForKids: false }), /sortie LiveKit/);
  assert.ok(!active.calls.some((c) => c.method === "DELETE"));
});

test("Calendar launch handles stale YouTube identity before camera access", () => {
  const source = readFileSync(
    new URL("../src/features/admin/live/pages/PilotokiLiveMatchLaunchPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /action: "recover_missing"/);
  assert.match(source, /setRecoveryRequired\(true\)/);
  assert.match(source, /result\.videoId !== broadcast\.id/);
  assert.match(source, /\(!broadcast \|\| recoveryRequired\)/);
});
