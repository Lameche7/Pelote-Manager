import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260730000500_add_modular_club_backoffice.sql",
  "utf8",
);
const router = readFileSync("src/app/router.tsx", "utf8");
const navigation = readFileSync(
  "src/features/admin/config/adminPermissions.ts",
  "utf8",
);
const shell = readFileSync(
  "src/features/admin/components/AdminShell.tsx",
  "utf8",
);

test("aucun club implicite n'est choisi par un fallback arbitraire", () => {
  assert.doesNotMatch(
    migration,
    /select\s+id\s+from\s+public\.clubs\s+limit\s+1/i,
  );
  assert.match(migration, /raise exception 'No club membership'/);
  assert.match(migration, /raise exception 'Club selection required'/);
});

test("les politiques Club sont fondées sur les permissions et l'appartenance", () => {
  assert.match(migration, /has_club_permission\(club_id, 'club\.manage'\)/);
  assert.match(migration, /has_club_permission\(club_id, 'pricing\.manage'\)/);
  assert.doesNotMatch(
    migration,
    /clubs_admin_all|club_seasons_admin_all|club_prices_admin_all/,
  );
});

test("les permissions filtrent à la fois les routes et le menu", () => {
  assert.match(router, /PermissionRoute/);
  assert.match(router, /ADMIN_PERMISSIONS\.pricing/);
  assert.match(router, /ADMIN_PERMISSIONS\.paymentsRead/);
  assert.match(shell, /hasPermission\(child\.permission\)/);
  assert.match(navigation, /payments\.manage/);
  assert.match(navigation, /pricing\.manage/);
});

test("les paramètres de réservation sont accessibles depuis le menu", () => {
  assert.match(router, /reservations\/parametres/);
  assert.match(navigation, /ROUTES\.adminReservationSettings/);
  assert.match(navigation, /Gestion des réservations/);
});
