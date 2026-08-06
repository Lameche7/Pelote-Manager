import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260806130000_add_admin_dashboard.sql";
const servicePath = "../src/features/admin/services/adminDashboardService.ts";
const pagePath = "../src/features/admin/pages/AdminPage.tsx";

test("le tableau de bord repose sur une projection sécurisée et isolée par club", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /create function public\.admin_get_dashboard\(\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /admin_current_club_id\(\)/);
  assert.match(
    migration,
    /has_club_permission\(club, 'admin\.dashboard\.read'\)/,
  );
  assert.match(
    migration,
    /grant execute on function public\.admin_get_dashboard/,
  );
  assert.doesNotMatch(migration, /guest_email|guest_phone/);
});

test("le service et la page consomment les données réelles du dashboard", async () => {
  const [service, page] = await Promise.all([
    read(servicePath),
    read(pagePath),
  ]);

  assert.match(service, /admin_get_dashboard/);
  assert.match(service, /reservationsToday/);
  assert.match(service, /nextReservations/);
  assert.match(service, /activeMembers/);
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

test("seuls les modules encore factices sont masqués de la navigation", async () => {
  const [navigation, shell] = await Promise.all([
    read("../src/features/admin/config/adminPermissions.ts"),
    read("../src/features/admin/components/AdminShell.tsx"),
  ]);

  assert.match(navigation, /label: "Tournois"[\s\S]*?enabled: false/);
  assert.match(
    navigation,
    /label: "Statistiques"[\s\S]*?permission: ADMIN_PERMISSIONS\.statistics/,
  );
  assert.doesNotMatch(
    navigation,
    /label: "Statistiques"[\s\S]{0,160}enabled: false/,
  );
  assert.match(
    navigation,
    /label: "Paramètres"[\s\S]*?permission: ADMIN_PERMISSIONS\.settings/,
  );
  assert.doesNotMatch(navigation, /label: "Paramètres"[\s\S]*?enabled: false/);
  assert.match(shell, /const isEnabled/);
  assert.match(shell, /isEnabled\(item\)/);
  assert.match(shell, /isEnabled\(child\)/);
});
