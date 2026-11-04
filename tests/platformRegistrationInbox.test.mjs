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
  assert.match(panel, /ne crée ni club, ni compte, ni abonnement/);
  assert.match(dashboard, /<PlatformRegistrationRequestsPanel \/>/);
  assert.match(sql, /reviewed_by_platform_user_id uuid/);
  assert.match(sql, /revoke all on public\.network_club_registration_requests/);
  assert.doesNotMatch(
    panel,
    /service.role|from\("network_club_registration_requests"\)/i,
  );
});
