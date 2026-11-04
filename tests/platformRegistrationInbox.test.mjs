import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("la console affiche les demandes sans accès direct à la table privée", async () => {
  const [api, panel, dashboard, sql] = await Promise.all([
    read("../api/platform-registration-requests.mjs"),
    read(
      "../src/features/platform/components/PlatformRegistrationRequestsPanel.tsx",
    ),
    read("../src/features/platform/pages/PlatformDashboardPage.tsx"),
    read(
      "../supabase/migrations/20261104120000_review_network_club_requests.sql",
    ),
  ]);

  assert.match(api, /\/auth\/v1\/user/);
  assert.match(api, /\/rest\/v1\/rpc\/platform_is_admin/);
  assert.match(api, /NETWORK_REGISTRATION_SERVICE_ROLE_KEY/);
  assert.match(api, /apikey: serviceKey/);
  assert.doesNotMatch(api, /authorization:.*serviceKey/);
  assert.match(
    api,
    /response\.setHeader\("cache-control", "no-store, private"\)/,
  );
  assert.match(api, /STATUSES = new Set/);
  assert.match(api, /reviewed_by_platform_user_id/);
  assert.match(api, /Cache|no-store/);
  assert.match(panel, /getSession\(\)/);
  assert.match(panel, /\/api\/platform-registration-requests/);
  assert.match(panel, /Accepter/);
  assert.match(panel, /Refuser/);
  assert.match(panel, /Marquer contacté/);
  assert.match(panel, /aucun abonnement payant ni paiement/);
  assert.match(
    dashboard,
    /<PlatformRegistrationRequestsPanel onClubRegistered=\{loadPlatform\} \/>/,
  );
  assert.match(sql, /reviewed_by_platform_user_id uuid/);
  assert.match(sql, /revoke all on public\.network_club_registration_requests/);
  assert.doesNotMatch(
    panel,
    /service.role|from\("network_club_registration_requests"\)/i,
  );
});

test("une session Supabase UUID valide franchit la vérification serveur", async () => {
  const source = await read("../api/platform-registration-requests.mjs");
  assert.match(
    source,
    /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/,
  );
  const { default: handler } =
    await import("../api/platform-registration-requests.mjs");
  const beforeFetch = globalThis.fetch;
  const envKeys = [
    "VITE_PLATFORM_SUPABASE_URL",
    "VITE_PLATFORM_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_URL",
    "NETWORK_REGISTRATION_SERVICE_ROLE_KEY",
  ];
  const previous = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  process.env.VITE_PLATFORM_SUPABASE_URL = "https://platform.example.test";
  process.env.VITE_PLATFORM_SUPABASE_ANON_KEY = "sb_publishable_test";
  process.env.VITE_SUPABASE_URL = "https://club.example.test";
  process.env.NETWORK_REGISTRATION_SERVICE_ROLE_KEY = "sb_secret_test";
  const hits = [];
  globalThis.fetch = async (url, options) => {
    hits.push({ url: String(url), headers: options?.headers });
    if (String(url).endsWith("/auth/v1/user")) {
      return new Response(
        JSON.stringify({ id: "f25a2a9f-5d2e-4a33-9430-0c218e19eabc" }),
        { status: 200 },
      );
    }
    if (String(url).includes("platform_is_admin")) {
      return new Response(JSON.stringify(true), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };
  const result = { statusCode: 200, body: null, headers: {} };
  const response = {
    setHeader(key, value) {
      result.headers[key] = value;
    },
    status(code) {
      result.statusCode = code;
      return response;
    },
    json(payload) {
      result.body = payload;
      return response;
    },
  };
  try {
    await handler(
      { method: "GET", headers: { authorization: "Bearer fake-session" } },
      response,
    );
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, { requests: [] });
    assert.equal(hits.length, 3);
    assert.equal(hits[2].headers.apikey, "sb_secret_test");
    assert.equal(hits[2].headers.authorization, undefined);
  } finally {
    globalThis.fetch = beforeFetch;
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
