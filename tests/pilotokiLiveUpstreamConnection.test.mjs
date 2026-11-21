import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { upstreamConnectionStatus, upstreamStreamInventory } from "../api/_live-upstream.mjs";

test("Absent Upstream token never calls the provider", async () => {
  const result = await upstreamConnectionStatus({}, () => {
    throw new Error("Unexpected external call");
  });
  assert.deepEqual(result, { configured: false, connected: false });
});

test("Upstream connectivity check passes secret only as server Bearer header", async () => {
  let seen;
  const result = await upstreamConnectionStatus(
    { UPSTREAM_API_TOKEN: "server-secret-test" },
    async (url, options) => {
      seen = { url, options };
      return { ok: true };
    },
  );
  assert.deepEqual(result, { configured: true, connected: true });
  assert.equal(seen.url, "https://studio.upstream.so/api/v1/user");
  assert.equal(seen.options.headers.Authorization, "Bearer server-secret-test");
  assert.doesNotMatch(JSON.stringify(result), /server-secret-test/);
});

test("Provider rejects an invalid key without revealing its response body", async () => {
  const result = await upstreamConnectionStatus(
    { UPSTREAM_API_TOKEN: "another-secret" },
    async () => ({
      ok: false,
      status: 401,
      text: () => "private-provider-error",
    }),
  );
  assert.deepEqual(result, { configured: true, connected: false });
});

test("Existing YouTube ingest endpoint enforces admin authentication for Upstream", () => {
  const api = readFileSync(
    new URL("../api/live-youtube-ingest.mjs", import.meta.url),
    "utf8",
  );
  assert.match(api, /if \(request\.method === "GET"\)/);
  assert.match(api, /await verifiedLiveClubAdmin\(request, process\.env\)/);
  assert.match(api, /await upstreamConnectionStatus\(process\.env\)/);
  assert.match(api, /const videoId = request\.body\?\.videoId/);
});

test("Admin UI offers explicit test and does not publish provider credentials", () => {
  const page = readFileSync(
    new URL(
      "../src/features/admin/live/pages/AdminLiveSettingsPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(page, /Tester la connexion Upstream/);
  assert.match(page, /UPSTREAM_API_TOKEN/);
  assert.match(page, /checkUpstreamConnection\(\)/);
  assert.doesNotMatch(page, /startUpstreamStream|stopUpstreamStream/);
});

test("Stream inventory only returns minimal allowlisted status fields", async () => {
  let checkedUrl = "";
  const result = await upstreamStreamInventory(
    { UPSTREAM_API_TOKEN: "read-only-test" },
    async (url, options) => {
      checkedUrl = url;
      assert.equal(options.headers.Authorization, "Bearer read-only-test");
      return {
        ok: true,
        json: async () => ({
          data: [{
            id: "11111111-1111-4111-8111-111111111111",
            name: "Test Lourdes Trinquet",
            status: "paused",
            type: "live",
            key: "SECRET-RMTP-KEY",
            destinations: [{ key: "SECRET" }],
          }],
        }),
      };
    },
  );
  assert.match(checkedUrl, /\/api\/v1\/streams\?page=1&per_page=50$/);
  assert.deepEqual(result, {
    configured: true,
    streams: [{
      id: "11111111-1111-4111-8111-111111111111",
      name: "Test Lourdes Trinquet",
      status: "paused",
      type: "live",
    }],
  });
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});

test("Inventory is restricted to the central pilot admin", () => {
  const endpoint = readFileSync(
    new URL("../api/live-youtube-ingest.mjs", import.meta.url),
    "utf8",
  );
  assert.match(endpoint, /if \(!admin\.canConnectGoogle\)/);
  assert.match(endpoint, /await upstreamStreamInventory\(process\.env\)/);
  assert.match(endpoint, /verifiedLiveClubAdmin\(request, process\.env\)/);
});

test("temporary formatter diagnostics", async () => {
  const prettier = await import("prettier");
  for (const [marker, path] of [
    ["FMT_INVENTORY_HELPER", "api/_live-upstream.mjs"],
    ["FMT_INVENTORY_BROADCAST", "api/_live-youtube-broadcast.mjs"],
    ["FMT_INVENTORY_INGEST", "api/live-youtube-ingest.mjs"],
    ["FMT_INVENTORY_UI", "src/features/admin/live/pages/AdminLiveSettingsPage.tsx"],
    ["FMT_INVENTORY_TEST", "tests/pilotokiLiveUpstreamConnection.test.mjs"],
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const formatted = await prettier.format(source, { filepath: path });
    console.log(marker, Buffer.from(formatted).toString("base64"));
  }
});
