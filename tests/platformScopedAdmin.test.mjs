import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const shell = read("src/features/admin/components/AdminShell.tsx");
const scoped = read("src/features/platform/components/PlatformScopedAdmin.tsx");
const layout = read("src/app/layouts/MainLayout.tsx");

test("administration preserves the selected club", () => {
  assert.ok(layout.includes("to={withClubPreview(ROUTES.admin)}"));
  assert.ok(
    shell.includes(
      "<PlatformScopedAdmin key={visualClubSlug} slug={visualClubSlug} />",
    ),
  );
});

test("foreign club administration never mounts legacy routes", () => {
  assert.doesNotMatch(scoped, /<Outlet\b/);
  assert.doesNotMatch(scoped, /admin_current_club_id/);
  assert.match(scoped, /platformAdminLeaseService\.issue\(selected\.id\)/);
  assert.match(scoped, /target_club_id: selected\.id/);
  assert.match(scoped, /if \(!club \|\| !modules\)/);
  assert.match(scoped, /<PlatformTournamentsPage clubId=\{club\.id\}/);
});

test("scoped admin renews only through the server and closes on sign out", () => {
  assert.match(scoped, /remaining - 60_000/);
  assert.match(scoped, /setTimeout\(close, remaining\)/);
  assert.match(scoped, /event === "SIGNED_OUT"/);
  assert.match(scoped, /platformAdminLeaseService\.revoke\(\)/);
  assert.match(scoped, /leaseQueue\.then\(operation, operation\)/);
});

test("club module editing remains outside the club back office", () => {
  assert.doesNotMatch(scoped, /PlatformClubModulesEditor/);
  assert.doesNotMatch(scoped, /ROUTES\.adminSettings/);
});
