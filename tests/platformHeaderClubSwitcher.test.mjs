import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const switcher = readFileSync(
  new URL(
    "../src/features/platform/components/PlatformClubSwitcher.tsx",
    import.meta.url,
  ),
  "utf8",
);
const layout = readFileSync(
  new URL("../src/app/layouts/MainLayout.tsx", import.meta.url),
  "utf8",
);

test("la gestion centrale exige une identité et un rôle vérifiés", () => {
  assert.match(switcher, /client\.auth\.getUser\(\)/);
  assert.match(switcher, /platform_is_admin/);
  assert.match(switcher, /allowed !== true/);
  assert.match(switcher, /if \(!isVerifiedAdmin\)/);
  assert.match(switcher, /identityLinked && clubs\.some/);
});

test("la navigation publique utilise le catalogue serveur", () => {
  assert.match(switcher, /list_network_clubs_v3/);
  assert.match(
    switcher,
    /publicClubs\.some\(\(club\) => club\.slug === slug\)/,
  );
  assert.match(switcher, /platform-business-clubs/);
  assert.match(layout, /<PlatformClubSwitcher \/>/);
});

test("le sélecteur conserve une préférence distincte par compte", () => {
  assert.match(switcher, /pilotoki-selected-club:/);
  assert.match(switcher, /list_my_member_clubs/);
  assert.match(switcher, /get_my_club_access/);
  assert.match(switcher, /event === "SIGNED_IN"/);
  assert.doesNotMatch(switcher, /event === "TOKEN_REFRESHED"/);
});
