import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  associateUpstreamStream,
  getUpstreamBinding,
  getOwnedUpstreamStream,
} from "../api/_live-upstream-binding.mjs";

const club = "188029a8-3e6a-41cd-821f-01984a703552";
const video = "11111111-1111-4111-8111-111111111111";
const stream = "22222222-2222-4222-8222-222222222222";
const env = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
  UPSTREAM_API_TOKEN: "readonly-secret",
};

test("Binding lookup is scoped to the authenticated club and video", async () => {
  let requestUrl = "";
  const result = await getUpstreamBinding(env, club, video, async (url) => {
    requestUrl = url;
    return {
      ok: true,
      json: async () => [{ upstream_stream_id: stream }],
    };
  });
  assert.deepEqual(result, { streamId: stream });
  assert.match(requestUrl, new RegExp("club_id=eq\\." + club));
  assert.match(requestUrl, new RegExp("video_id=eq\\." + video));
});

test("Provider ownership and paused status must be confirmed read-only", async () => {
  const calls = [];
  const item = await getOwnedUpstreamStream(env, stream, async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => ({ data: { id: stream, status: "paused" } }),
    };
  });
  assert.deepEqual(item, { id: stream, status: "paused" });
  assert.equal(calls[0].opts.headers.Authorization, "Bearer readonly-secret");
  assert.equal(calls[0].opts.method, undefined);
  assert.doesNotMatch(JSON.stringify(item), /secret/);
  await assert.rejects(
    getOwnedUpstreamStream(env, stream, async () => ({
      ok: true,
      json: async () => ({ data: { id: stream, status: "active" } }),
    })),
    /Arrêtez d'abord/,
  );
  await assert.rejects(
    getOwnedUpstreamStream(env, "invalid", async () => {
      throw new Error("should not call");
    }),
    /Flux Upstream invalide/,
  );
});

test("Binding never overwrites a different previously associated stream", async () => {
  let mutation = false;
  await assert.rejects(
    associateUpstreamStream(env, club, video, stream, async (url, opts) => {
      if (url.includes("studio.upstream.so"))
        return {
          ok: true,
          json: async () => ({ data: { id: stream, status: "paused" } }),
        };
      if (opts?.method === "POST") mutation = true;
      return {
        ok: true,
        json: async () => [
          { upstream_stream_id: "33333333-3333-4333-8333-333333333333" },
        ],
      };
    }),
    /Une autre régie/,
  );
  assert.equal(mutation, false);
});

test("Association records only club, video and stream identifier", async () => {
  const calls = [];
  const result = await associateUpstreamStream(
    env,
    club,
    video,
    stream,
    async (url, opts = {}) => {
      calls.push({ url, opts });
      if (url.includes("studio.upstream.so"))
        return {
          ok: true,
          json: async () => ({ data: { id: stream, status: "paused" } }),
        };
      if (opts.method === "POST") return { ok: true, status: 201 };
      return { ok: true, json: async () => [] };
    },
  );
  assert.deepEqual(result, { streamId: stream, alreadyLinked: false });
  const write = calls.find((request) => request.opts.method === "POST");
  assert.equal(write.opts.headers.apikey, "service-secret");
  assert.deepEqual(JSON.parse(write.opts.body), {
    video_id: video,
    club_id: club,
    upstream_stream_id: stream,
  });
  assert.doesNotMatch(write.opts.body, /secret|Bearer/);
});

test("Only pilot administrator can create association and actions cannot start a stream", () => {
  const api = readFileSync(
    new URL("../api/live-youtube-ingest.mjs", import.meta.url),
    "utf8",
  );
  const ui = readFileSync(
    new URL(
      "../src/features/admin/live/components/PilotokiLiveLaunchAssistant.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261121180000_pilotoki_live_upstream_bindings.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(api, /request\.body\?\.action === "associate_upstream"/);
  assert.match(api, /if \(!canConnectGoogle\)/);
  assert.match(api, /request\.body\?\.confirmed !== true/);
  assert.match(ui, /Associer ce flux Upstream à cette vidéo/);
  assert.match(ui, /confirmedDestination/);
  assert.doesNotMatch(api, /UPSTREAM_API_FULL_TOKEN|\/start|\/stop/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all.*authenticated/);
  assert.match(migration, /unique/);
});
