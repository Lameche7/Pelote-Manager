import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { handleWhip } from "../api/live-browser-ingest.mjs";

const clubId = "188029a8-3e6a-41cd-821f-01984a703552";
const videoId = "22222222-2222-4222-8222-222222222222";
const env = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon-fixture",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
  LIVE_WHIP_INGEST_URL: "https://media.example.org/whip",
  LIVE_WHIP_API_TOKEN: "whip-test-value",
  LIVE_WHIP_SESSION_SECRET: "whip-session-test-secret",
};

function fakeResponse() {
  return {
    code: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}
function mockFetch({ connected = true, videoStatus = "scheduled" } = {}) {
  const calls = [];
  const mock = async (url, options = {}) => {
    const pathname = String(url);
    calls.push({ url: pathname, options });
    if (pathname.endsWith("/auth/v1/user"))
      return { ok: true, json: async () => ({ id: videoId }) };
    if (pathname.endsWith("/rpc/admin_get_club_live_settings"))
      return {
        ok: true,
        json: async () => ({
          club_id: clubId,
          youtube_channel_id: "UCAIME5j0y9DdiEQNyttO_jw",
          connection_status: connected ? "connected" : "disconnected",
          can_connect_google: true,
        }),
      };
    if (pathname.includes("/pilotoki_live_videos?"))
      return {
        ok: true,
        json: async () => [{
          id: videoId,
          club_id: clubId,
          status: videoStatus,
        }],
      };
    if (pathname === env.LIVE_WHIP_INGEST_URL)
      return {
        status: 201,
        headers: new Headers({ location: "/sessions/123" }),
        text: async () => "v=0\r\no=remote 1 1 IN IP4 127.0.0.1\r\n",
      };
    if (pathname === "https://media.example.org/sessions/123")
      return { status: 204 };
    throw new Error("Unexpected request");
  };
  return { mock, calls };
}
const request = {
  method: "POST",
  headers: { authorization: "Bearer user-token" },
  body: {
    videoId,
    offer: "v=0\r\no=sender 1 1 IN IP4 127.0.0.1\r\n",
  },
};

test("Authenticated mobile SDP is proxied without leaking service token", async () => {
  const { mock, calls } = mockFetch();
  const res = fakeResponse();
  await handleWhip(request, res, env, mock);
  assert.equal(res.code, 201);
  assert.match(res.body.answer, /^v=0/);
  assert.equal(typeof res.body.session, "string");
  assert.doesNotMatch(JSON.stringify(res.body), /whip-test-value/);
  const mediaCall = calls.find((call) => call.url === env.LIVE_WHIP_INGEST_URL);
  assert.equal(mediaCall.options.method, "POST");
  assert.equal(
    mediaCall.options.headers.Authorization,
    "Bearer whip-test-value",
  );
});

test("Mobile sender may close its session after YouTube changes status to live", async () => {
  const { mock, calls } = mockFetch({ videoStatus: "live" });
  const created = fakeResponse();
  const scheduled = mockFetch();
  await handleWhip(request, created, env, scheduled.mock);
  assert.equal(created.code, 201);
  const stopped = fakeResponse();
  await handleWhip(
    {
      method: "DELETE",
      headers: request.headers,
      body: { videoId, session: created.body.session },
    },
    stopped,
    env,
    mock,
  );
  assert.equal(stopped.code, 200);
  assert.ok(calls.some((call) => call.options.method === "DELETE"));
});

test("Unconfigured or unauthorized provider never receives camera signalling", async () => {
  const { mock, calls } = mockFetch({ connected: false });
  const res = fakeResponse();
  await handleWhip(request, res, env, mock);
  assert.equal(res.code, 409);
  assert.equal(
    calls.some((call) => call.url === env.LIVE_WHIP_INGEST_URL),
    false,
  );
});

test("The mobile page never calls YouTube directly or claims WebRTC equals public live", () => {
  const text = readFileSync(
    new URL(
      "../src/features/admin/live/pages/PilotokiLiveMobilePublisherPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(text, /RTCPeerConnection/);
  assert.match(text, /getUserMedia/);
  assert.match(text, /Connecter ma caméra/);
  assert.doesNotMatch(text, /liveBroadcasts\/transition/);
});
