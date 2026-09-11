import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  routes,
  userShell,
  dashboard,
  playerPage,
  adminPage,
  service,
  schemaMigration,
  workflowMigration,
  paymentMigration,
  checkout,
] = await Promise.all([
  read("../src/shared/config/routes.ts"),
  read("../src/features/user-space/components/UserSpaceShell.tsx"),
  read("../src/features/user-space/dashboard/pages/UserSpaceDashboardPage.tsx"),
  read("../src/features/licences/pages/MyLicencePage.tsx"),
  read("../src/features/admin/members/pages/AdminLicencesPage.tsx"),
  read("../src/features/licences/services/licenceService.ts"),
  read("../supabase/migrations/20260911103000_add_licence_requests.sql"),
  read("../supabase/migrations/20260911103100_add_licence_workflows.sql"),
  read("../supabase/migrations/20260911103200_extend_helloasso_to_licences.sql"),
  read("../supabase/functions/create-helloasso-checkout/index.ts"),
]);

test("expose Ma licence dans l'espace joueur", () => {
  assert.match(routes, /myLicence: "\/mon-espace\/licence"/);
  assert.match(userShell, /Ma licence/);
  assert.match(dashboard, /Demander ou renouveler votre licence/);
});

test("distingue renouvellement et première licence", () => {
  assert.match(schemaMigration, /'renewal', 'first_application'/);
  assert.match(playerPage, /certificat médical/i);
  assert.match(playerPage, /Première licence/);
  assert.match(workflowMigration, /request_kind := 'renewal'/);
  assert.match(workflowMigration, /request_kind := 'first_application'/);
});

test("stocke les documents de licence dans un bucket privé", () => {
  assert.match(schemaMigration, /'licence-documents'/);
  assert.match(schemaMigration, /false,\s*10485760/);
  assert.match(schemaMigration, /licence_documents_player_insert/);
  assert.match(schemaMigration, /has_club_permission\(request\.club_id, 'members\.manage'\)/);
  assert.match(service, /from\("licence-documents"\)/);
  assert.match(service, /createSignedUrl/);
});

test("le tarif est fixé par la campagne et figé sur la demande", () => {
  assert.match(workflowMigration, /request_amount := campaign_row\.renewal_price_cents/);
  assert.match(workflowMigration, /request_amount := campaign_row\.first_application_price_cents/);
  assert.match(adminPage, /Tarif renouvellement/);
  assert.match(adminPage, /Tarif première licence/);
});

test("réutilise le paiement HelloAsso pour les licences", () => {
  assert.match(schemaMigration, /payment_context text not null default 'reservation'/);
  assert.match(paymentMigration, /payment\.payment_context='licence'/);
  assert.match(checkout, /payment\.payment_context === "licence"/);
  assert.match(checkout, /\/mon-espace\/licence/);
  assert.match(checkout, /licence_request_id/);
});

test("l'admin garde la validation finale de la licence", () => {
  assert.match(workflowMigration, /target_action='approve'/);
  assert.match(workflowMigration, /target_action='mark_licensed'/);
  assert.match(workflowMigration, /licence_renewed_online/);
  assert.match(workflowMigration, /first_licence_created_online/);
  assert.match(adminPage, /Confirmer le renouvellement/);
  assert.match(adminPage, /Enregistrer la licence/);
});
