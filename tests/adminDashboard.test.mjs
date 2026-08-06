import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le tableau de bord repose sur une projection sécurisée et isolée par club", async () => {
  const migration = await read(
    "../supabase/migrations/20260806130000_add_admin_dashboard.sql",
  );

  assert.match(migration, /create function public\.admin_get_dashboard\(\)/);
  assert.match(migration, /public\.admin_current_club_id\(\)/);
  assert.match(
    migration,
    /public\.has_club_permission\(club, 'admin\.dashboard\.read'\)/,
  );
  assert.match(migration, /resources\.club_id = club/);
  assert.match(migration, /members\.club_id = club/);
  assert.match(migration, /events\.club_id = club/);
  assert.match(migration, /communications\.club_id = club/);
  assert.match(
    migration,
    /revoke all on function public\.admin_get_dashboard\(\) from public/,
  );
  assert.match(
    migration,
    /grant execute on function public\.admin_get_dashboard\(\) to authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /customer_name|guest_email|guest_phone|display_name/,
  );
});

test("le service et la page consomment les données réelles du dashboard", async () => {
  const [service, page] = await Promise.all([
    read("../src/features/admin/services/adminDashboardService.ts"),
    read("../src/features/admin/pages/AdminPage.tsx"),
  ]);

  assert.match(service, /supabase\.rpc\("admin_get_dashboard"\)/);
  assert.match(service, /reservationsToday/);
  assert.match(service, /activeCommunications/);
  assert.match(page, /adminDashboardService\.getDashboard\(\)/);
  assert.match(page, /Prochaines réservations/);
  assert.match(page, /Communications actives/);
  assert.match(page, /Activité récente/);
  assert.doesNotMatch(page, /Indicateur prêt à être connecté/);
  assert.doesNotMatch(
    page,
    /Les prochaines réservations et opérations apparaîtront ici/,
  );
});

test("les modules encore factices sont masqués de la navigation", async () => {
  const [navigation, shell] = await Promise.all([
    read("../src/features/admin/config/adminPermissions.ts"),
    read("../src/features/admin/components/AdminShell.tsx"),
  ]);

  for (const label of ["Tournois", "Statistiques", "Paramètres"]) {
    assert.match(
      navigation,
      new RegExp(`label: "${label}"[\\s\\S]*?enabled: false`),
    );
  }
  assert.match(shell, /const isEnabled/);
  assert.match(shell, /isEnabled\(item\)/);
  assert.match(shell, /isEnabled\(child\)/);
});
