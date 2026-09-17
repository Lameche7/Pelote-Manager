import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("le back-office expose les inscrits PILOTOKI sans licence active", async () => {
  const [
    migration,
    fixMigration,
    page,
    service,
    hooks,
    navigation,
    routes,
    router,
  ] = await Promise.all([
    read(
      "supabase/migrations/20260916193000_add_admin_unlicensed_pilotoki_users.sql",
    ),
    read(
      "supabase/migrations/20260917061000_fix_admin_unlicensed_inactive_members.sql",
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
  assert.match(
    migration,
    /has_club_permission\(current_club, 'members\.manage'\)/,
  );
  assert.match(migration, /not coalesce\(member_season\.is_licensed, false\)/);
  assert.match(migration, /member\.id is not null and not member\.is_active/);
  assert.match(fixMigration, /member\.id is not null and not member\.is_active/);
  assert.match(
    migration,
    /profile\.member_id is null or member\.id is not null/,
  );
  assert.match(service, /admin_list_unlicensed_pilotoki_users/);
  assert.match(hooks, /useUnlicensedPilotokiUsers/);
  assert.match(page, /Inscrits sans licence/);
  assert.match(page, /Compte non rattaché/);
  assert.match(navigation, /Inscrits sans licence/);
  assert.match(routes, /adminUnlicensedUsers/);
  assert.match(router, /AdminUnlicensedPilotokiUsersPage/);
});

test("un administrateur peut rattacher manuellement un compte à une licence", async () => {
  const [migration, page, service, hooks] = await Promise.all([
    read(
      "supabase/migrations/20260916211500_add_admin_profile_licence_linking.sql",
    ),
    read(
      "src/features/admin/members/pages/AdminUnlicensedPilotokiUsersPage.tsx",
    ),
    read("src/features/admin/members/services/memberAdminService.ts"),
    read("src/features/admin/members/hooks/useAdminMembers.ts"),
  ]);

  assert.match(migration, /admin_preview_profile_licence_link/);
  assert.match(migration, /admin_link_unlicensed_profile/);
  assert.match(migration, /affiliation_kind not in \('primary', 'extension'\)/);
  assert.match(migration, /sport_player_club_affiliations/);
  assert.match(migration, /set_config\('app\.allow_profile_member_link'/);
  assert.match(migration, /set_config\('app\.allow_profile_sport_player_link'/);
  assert.match(migration, /admin_account_linked/);
  assert.match(
    migration,
    /Cette licence possède déjà un club principal : utilisez Extension/,
  );
  assert.match(service, /previewProfileLicenceLink/);
  assert.match(service, /linkUnlicensedProfile/);
  assert.match(hooks, /usePreviewProfileLicenceLink/);
  assert.match(hooks, /useLinkUnlicensedProfile/);
  assert.match(page, /Rattacher/);
  assert.match(page, /Licence au club/);
  assert.match(page, /Extension depuis un autre club/);
  assert.match(page, /Vérifier la licence/);
});
