import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// prettier-ignore
test("le back-office peut auditer et rattacher les comptes tournoi", async () => {
  const [baseMigration, pendingMigration, page, service, routes, navigation, router] = await Promise.all([
    read("supabase/migrations/20260917113000_add_admin_tournament_account_audit.sql"),
    read("supabase/migrations/20260921092000_show_pending_email_confirmation_in_tournament_accounts.sql"),
    read("src/features/admin/tournaments/pages/AdminTournamentAccountsPage.tsx"),
    read("src/features/admin/tournaments/services/adminTournamentAccountService.ts"),
    read("src/shared/config/routes.ts"),
    read("src/features/admin/config/adminPermissions.ts"),
    read("src/app/router.tsx"),
  ]);

  assert.match(baseMigration, /admin_list_tournament_account_audit/);
  assert.match(baseMigration, /admin_search_tournament_account_candidates/);
  assert.match(baseMigration, /admin_link_tournament_account/);
  assert.match(baseMigration, /verification_method = 'admin_manual'/);
  assert.match(baseMigration, /has_club_permission\(current_club, 'tournaments\.manage'\)/);

  assert.match(pendingMigration, /email_confirmed_at/);
  assert.match(pendingMigration, /pending_confirmation/);
  assert.match(pendingMigration, /'emailConfirmed'/);
  assert.match(pendingMigration, /revoke all on function public\.admin_list_tournament_account_audit/);

  assert.match(page, /Compte créé — confirmation email en attente/);
  assert.match(page, /Rattachement automatique après confirmation/);
  assert.match(page, /Rechercher un compte/);
  assert.match(page, /Rattacher ce compte/);
  assert.match(page, /À suivre/);

  assert.match(service, /pending_confirmation/);
  assert.match(service, /emailConfirmed/);
  assert.match(service, /admin_list_tournament_account_audit/);
  assert.match(routes, /adminTournamentAccounts/);
  assert.match(navigation, /Comptes joueurs/);
  assert.match(router, /AdminTournamentAccountsPage/);
});
