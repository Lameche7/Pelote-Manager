import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(
  "src/features/platform/components/PlatformBusinessClubAccessPanel.tsx",
  "utf8",
);
const dashboard = readFileSync(
  "src/features/platform/pages/PlatformDashboardPage.tsx",
  "utf8",
);

test("le tableau de bord raccorde la fiche métier isolée", () => {
  assert.match(dashboard, /<PlatformBusinessClubAccessPanel \/>/);
  assert.match(panel, /platform-business-clubs/);
  assert.match(panel, /platformAdminLeaseService\.issue\(\)/);
  assert.match(
    panel,
    /<PlatformClubInformationEditor clubId=\{authorizedClubId\}/,
  );
});

test("le choix visuel ne suffit pas pour ouvrir la fiche métier", () => {
  assert.match(panel, /clubs\.some\(\(club\) => club\.id === clubId\)/);
  assert.match(panel, /if \(!lease\.enabled\)/);
  assert.match(panel, /setAuthorizedClubId\(clubId\)/);
  assert.doesNotMatch(panel, /adminClubId/);
});

test("une autorisation tardive est révoquée après fermeture", () => {
  assert.match(panel, /mounted\.current = false/);
  assert.match(panel, /leaseRequest\.current \+= 1/);
  assert.match(panel, /requestId !== leaseRequest\.current/);
  assert.match(panel, /platformAdminLeaseService\.revoke\(\)/);
});

test("la fiche se referme à l'expiration du bail serveur", () => {
  assert.match(panel, /Date\.parse\(lease\.expiresAt/);
  assert.match(panel, /remaining <= 0/);
  assert.match(panel, /expiryTimer\.current = setTimeout/);
  assert.match(panel, /setAuthorizedClubId\(""/);
  assert.match(panel, /clearTimeout\(expiryTimer\.current\)/);
});
