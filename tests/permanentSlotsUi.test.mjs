import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("les RPC d'interface des créneaux permanents sont versionnés", async () => {
  const migration = await read(
    "../supabase/migrations/20260913090000_add_permanent_slot_ui_api.sql",
  );

  assert.match(migration, /admin_list_permanent_slot_candidates/);
  assert.match(migration, /has_my_permanent_slots/);
  assert.match(migration, /reservations\.manage/);
  assert.match(migration, /grant execute .* authenticated/is);
});

test("les routes admin et utilisateur exposent les créneaux permanents", async () => {
  const [routes, router] = await Promise.all([
    read("../src/shared/config/routes.ts"),
    read("../src/app/router.tsx"),
  ]);

  assert.match(routes, /myPermanentSlots/);
  assert.match(routes, /adminPermanentSlots/);
  assert.match(router, /MyPermanentSlotsPage/);
  assert.match(router, /AdminPermanentSlotsPage/);
});

test("le menu utilisateur est réservé aux titulaires de créneaux permanents", async () => {
  const dashboard = await read(
    "../src/features/user-space/dashboard/pages/UserSpaceDashboardPage.tsx",
  );

  assert.match(dashboard, /hasPermanentSlots/);
  assert.match(dashboard, /Mes créneaux permanents/);
  assert.match(dashboard, /ROUTES\.myPermanentSlots/);
});

test("le titulaire peut maintenir, libérer puis reprendre une occurrence", async () => {
  const [page, service] = await Promise.all([
    read("../src/features/reservations/pages/MyPermanentSlotsPage.tsx"),
    read("../src/features/reservations/services/permanentSlotService.ts"),
  ]);

  assert.match(page, /Maintenir/);
  assert.match(page, /Libérer ce créneau/);
  assert.match(page, /Reprendre mon créneau/);
  assert.match(service, /list_my_permanent_slot_occurrences/);
  assert.match(service, /set_my_permanent_slot_occurrence_status/);
});

test("l'administration peut créer et désactiver un créneau permanent", async () => {
  const [page, service, navigation] = await Promise.all([
    read(
      "../src/features/admin/reservations/pages/AdminPermanentSlotsPage.tsx",
    ),
    read(
      "../src/features/admin/reservations/services/adminPermanentSlotService.ts",
    ),
    read("../src/features/admin/config/adminPermissions.ts"),
  ]);

  assert.match(page, /Nouveau créneau permanent/);
  assert.match(page, /managementWindowHours/);
  assert.match(page, /primaryProfileId/);
  assert.match(service, /admin_create_permanent_slot/);
  assert.match(service, /admin_deactivate_permanent_slot/);
  assert.match(navigation, /Créneaux permanents/);
});
