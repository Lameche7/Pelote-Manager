import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("la projection statistique est limitée au club et à la permission dédiée", async () => {
  const migration = await read(
    "../supabase/migrations/20260806170000_add_admin_club_statistics.sql",
  );

  assert.match(
    migration,
    /create function public\.admin_get_club_statistics\([\s\S]*target_start_date date,[\s\S]*target_end_date date/,
  );
  assert.match(
    migration,
    /target_club_id := public\.admin_current_club_id\(\)/,
  );
  assert.match(
    migration,
    /public\.has_club_permission\(target_club_id, 'statistics\.read'\)/,
  );
  assert.match(migration, /resources\.club_id = target_club_id/);
  assert.match(migration, /target_end_date - target_start_date > 366/);
  assert.match(
    migration,
    /grant execute on function public\.admin_get_club_statistics\(date, date\) to authenticated/,
  );
  assert.doesNotMatch(migration, /guest_email|guest_phone|provider_payment_id/);
});

test("les indicateurs couvrent occupation, fréquentation et finances", async () => {
  const migration = await read(
    "../supabase/migrations/20260806170000_add_admin_club_statistics.sql",
  );

  assert.match(migration, /public\.resource_opening_hours/);
  assert.match(
    migration,
    /generate_series\([\s\S]*target_start_date,[\s\S]*target_end_date/,
  );
  assert.match(migration, /'occupancy_rate'/);
  assert.match(migration, /'cancellation_rate'/);
  assert.match(migration, /'expected_revenue_cents'/);
  assert.match(migration, /'paid_revenue_cents'/);
  assert.match(migration, /'licensee_reservations'/);
  assert.match(migration, /'by_resource'/);
  assert.match(migration, /'by_weekday'/);
  assert.match(migration, /'by_hour'/);
  assert.match(migration, /'payment_statuses'/);
});

test("l’écran statistiques est réel, filtrable et visible dans le Back Office", async () => {
  const [service, page, router, permissions] = await Promise.all([
    read("../src/features/admin/statistics/services/adminStatisticsService.ts"),
    read("../src/features/admin/statistics/pages/AdminStatisticsPage.tsx"),
    read("../src/app/router.tsx"),
    read("../src/features/admin/config/adminPermissions.ts"),
  ]);

  assert.match(service, /supabase\.rpc\("admin_get_club_statistics"/);
  assert.match(service, /target_start_date: startDate/);
  assert.match(service, /target_end_date: endDate/);
  assert.match(page, /Statistiques du club/);
  assert.match(page, /Taux d’occupation/);
  assert.match(page, /Montant encaissé/);
  assert.match(page, /Résultats par terrain/);
  assert.match(page, /Saison \{statistics\.activeSeason\.name\}/);
  assert.match(router, /import \{ AdminStatisticsPage \}/);
  assert.match(router, /<AdminStatisticsPage \/>/);
  assert.match(
    permissions,
    /label: "Statistiques",[\s\S]*permission: ADMIN_PERMISSIONS\.statistics,[\s\S]*\},/,
  );
  assert.doesNotMatch(
    permissions,
    /label: "Statistiques",[\s\S]{0,180}enabled: false/,
  );
});
