import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("le back-office peut auditer et rattacher les comptes tournoi", async () => {
  const [migration, page, service, routes, navigation, router] = await Promise.all([
    read("supabase/migrations/20260917113000_add_admin_tournament_account_audit.sql"),
    read("src/features/admin/tournaments/pages/AdminTournamentAccountsPage.tsx"),
    read("src/features/admin/tournaments/services/adminTournamentAccountService.ts"),
    read("src/shared/config/routes.ts"),
    read("src/features/admin/config/adminPermissions.ts"),
    read("src/app/router.tsx"),
  ]);

  assert.match(migration, /admin_list_tournament_account_audit/);
  assert.match(migration, /admin_search_tournament_account_candidates/);
  assert.match(migration, /admin_link_tournament_account/);
  assert.match(migration, /verification_method = 'admin_manual'/);
  assert.match(migration, /has_club_permission\(current_club, 'tournaments\.manage'\)/);
  assert.match(page, /Comptes joueurs/);
  assert.match(page, /À corriger/);
  assert.match(page, /Confirmer le rattachement/);
  assert.match(service, /admin_list_tournament_account_audit/);
  assert.match(routes, /adminTournamentAccounts/);
  assert.match(navigation, /Comptes joueurs/);
  assert.match(router, /AdminTournamentAccountsPage/);
});
