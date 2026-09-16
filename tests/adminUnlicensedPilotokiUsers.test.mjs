import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("le back-office expose les inscrits PILOTOKI sans licence active", async () => {
  const [migration, page, service, hooks, navigation, routes, router] =
    await Promise.all([
      read(
        "supabase/migrations/20260916193000_add_admin_unlicensed_pilotoki_users.sql",
      ),
      read(
        "src/features/admin/members/pages/AdminUnlicensedPilotokiUsersPage.tsx",
      ),
      read("src/features/admin/members/services/memberAdminService.ts"),
      read("src/features/admin/members/hooks/useAdminMembers.ts"),
      read("src/features/admin/config/adminPermissions.ts"),
      read("src/shared/config/routes.ts"),
      read("src/app/router.tsx"),
    ]);

  assert.match(migration, /admin_list_unlicensed_pilotoki_users/);
  assert.match(migration, /has_club_permission\(current_club, 'members\.manage'\)/);
  assert.match(migration, /not coalesce\(member_season\.is_licensed, false\)/);
  assert.match(migration, /profile\.member_id is null or member\.id is not null/);
  assert.match(service, /admin_list_unlicensed_pilotoki_users/);
  assert.match(hooks, /useUnlicensedPilotokiUsers/);
  assert.match(page, /Inscrits sans licence/);
  assert.match(page, /Compte non rattaché/);
  assert.match(navigation, /Inscrits sans licence/);
  assert.match(routes, /adminUnlicensedUsers/);
  assert.match(router, /AdminUnlicensedPilotokiUsersPage/);
});
