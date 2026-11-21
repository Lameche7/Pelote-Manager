import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { upstreamConnectionStatus } from "../api/_live-upstream.mjs";

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
    async () => ({ ok: false, status: 401, text: () => "private-provider-error" }),
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
    new URL("../src/features/admin/live/pages/AdminLiveSettingsPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /Tester la connexion Upstream/);
  assert.match(page, /UPSTREAM_API_TOKEN/);
  assert.match(page, /checkUpstreamConnection\(\)/);
  assert.doesNotMatch(page, /startUpstreamStream|stopUpstreamStream/);
});

test("temporary exact Prettier output", async () => {
  const prettier = await import("prettier");
  for (const path of [
    "src/features/admin/live/pages/AdminLiveSettingsPage.tsx",
    "src/features/admin/live/services/adminLiveSettingsService.ts",
    "tests/pilotokiLiveUpstreamConnection.test.mjs",
  ]) {
    const content = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    const formatted = await prettier.format(content, { filepath: path });
    console.log(
      path.includes("pages/")
        ? "FMT_UPSTREAM_ADMIN"
        : path.includes("services/")
          ? "FMT_UPSTREAM_SERVICE"
          : "FMT_UPSTREAM_TEST",
      Buffer.from(formatted).toString("base64"),
    );
  }
});
