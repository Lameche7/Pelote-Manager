import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("l'acceptation préserve le palier commercial et évite tout provisionnement", async () => {
  const [api, central, source, panel] = await Promise.all([
    load("../api/platform-registration-requests.mjs"),
    load("../supabase/platform/migrations/20261104205000_register_network_applications.sql"),
    load("../supabase/migrations/20261104205100_link_approved_registrations.sql"),
    load("../src/features/platform/components/PlatformRegistrationRequestsPanel.tsx"),
  ]);
  assert.match(api, /platform_register_network_application/);
  assert.match(api, /buildClubSlug/);
  assert.match(api, /platform_club_id: centralClubId/);
  assert.match(api, /status=neq.approved/);
  assert.match(api, /requested_plan/);
  assert.match(central, /source_registration_request_id/);
  assert.match(central, /pg_advisory_xact_lock/);
  assert.match(central, /target_plan not in \('essentiel','club','premium'\)/);
  assert.match(central, /not public.is_platform_admin\(\)/);
  assert.doesNotMatch(central, /insert into public\.platform_provisioning_jobs/);
  assert.match(source, /platform_club_id uuid/);
  assert.match(panel, /Accepter et créer la fiche/);
  assert.match(panel, /request\.status === "approved"/);
});

test("la validation du serveur ignore les données commerciales du navigateur", async () => {
  const { default: handler } = await import(
    "../api/platform-registration-requests.mjs"
  );
  const originalFetch = globalThis.fetch;
  const keys = [
    "VITE_PLATFORM_SUPABASE_URL",
    "VITE_PLATFORM_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_URL",
    "NETWORK_REGISTRATION_SERVICE_ROLE_KEY",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    VITE_PLATFORM_SUPABASE_URL: "https://platform.example.test",
    VITE_PLATFORM_SUPABASE_ANON_KEY: "sb_publishable_test",
    VITE_SUPABASE_URL: "https://club.example.test",
    NETWORK_REGISTRATION_SERVICE_ROLE_KEY: "sb_secret_test",
  });
  const requestId = "c3fb704f-7c7b-42ef-b567-05ffab68496b";
  const clubId = "e25e5ea7-8e42-4ceb-bf6d-2360eb1e5923";
  const calls = [];
  let saved = {
    id: requestId,
    club_name: "TEST PILOTOKI - CLUB FICTIF",
    contact_email: "test@example.invalid",
    contact_name: "Responsable Test",
    city: "Tarbes",
    requested_plan: "club",
    status: "contacted",
    platform_club_id: null,
  };
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    calls.push({ path, options });
    if (path.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({
        id: "f25a2a9f-5d2e-4a33-9430-0c218e19eabc",
      }), { status: 200 });
    }
    if (path.includes("/rpc/platform_is_admin")) {
      return new Response("true", { status: 200 });
    }
    if (path.includes("/rpc/platform_register_network_application")) {
      const input = JSON.parse(options.body);
      assert.equal(input.target_request_id, requestId);
      assert.equal(input.target_plan, "club");
      assert.equal(input.target_name, "TEST PILOTOKI - CLUB FICTIF");
      assert.notEqual(input.target_name, "Injected club");
      return new Response(JSON.stringify(clubId), { status: 200 });
    }
    if (path.includes("network_club_registration_requests")) {
      if (options.method === "PATCH") {
        saved = { ...saved, ...JSON.parse(options.body) };
      }
      return new Response(JSON.stringify([saved]), { status: 200 });
    }
    throw new Error("Unexpected request: " + path);
  };
  const response = () => {
    const state = { statusCode: 200, body: null };
    return {
      state,
      setHeader() {},
      status(code) {
        state.statusCode = code;
        return this;
      },
      json(data) {
        state.body = data;
        return this;
      },
    };
  };
  try {
    const res = response();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer mock-central-jwt" },
      body: {
        id: requestId,
        status: "approved",
        club_name: "Injected club",
        requested_plan: "premium",
      },
    }, res);
    assert.equal(res.state.statusCode, 200);
    assert.equal(res.state.body.request.status, "approved");
    assert.equal(res.state.body.request.platform_club_id, clubId);
    assert.equal(calls.filter((x) =>
      x.path.includes("/rpc/platform_register_network_application")
    ).length, 1);
    assert.equal(calls.find((x) =>
      x.path.includes("/rpc/platform_register_network_application")
    ).options.headers.authorization, "Bearer mock-central-jwt");
    assert.ok(calls.find((x) =>
      x.path.includes("network_club_registration_requests")
    ).options.headers.apikey === "sb_secret_test");

    const again = response();
    await handler({
      method: "POST",
      headers: { authorization: "Bearer mock-central-jwt" },
      body: { id: requestId, status: "approved" },
    }, again);
    assert.equal(again.state.statusCode, 200);
    assert.equal(calls.filter((x) =>
      x.path.includes("/rpc/platform_register_network_application")
    ).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
