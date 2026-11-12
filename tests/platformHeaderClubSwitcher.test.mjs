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

test("le sélecteur exige une identité et un rôle plateforme vérifiés", () => {
  assert.match(switcher, /client\.auth\.getUser\(\)/);
  assert.match(switcher, /platform_is_admin/);
  assert.match(switcher, /allowed !== true/);
  assert.match(switcher, /if \(!isVerifiedAdmin\) return null/);
});

test("les clubs viennent du catalogue protégé et non du navigateur", () => {
  assert.match(switcher, /platform-business-clubs/);
  assert.match(switcher, /clubs\.some\(\(club\) => club\.slug === slug\)/);
  assert.match(layout, /<PlatformClubSwitcher \/>/);
});

test("le sélecteur n'annonce pas des droits d'administration inter-clubs", () => {
  assert.match(switcher, /Aperçu visuel du club \(super-admin\)/);
  assert.match(switcher, /pas les données ni les droits d’administration/);
  assert.doesNotMatch(switcher, /Club par défaut \(Lourdes\)/);
  assert.match(switcher, /event === "SIGNED_IN"/);
  assert.doesNotMatch(switcher, /event === "TOKEN_REFRESHED"/);
});
