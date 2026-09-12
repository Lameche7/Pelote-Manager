import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  migration,
  routes,
  navigation,
  router,
  adminPage,
  service,
  calendar,
  calendarService,
  reservationsPage,
] = await Promise.all([
  read(
    "../supabase/migrations/20260911170050_add_championship_reservation_priority.sql",
  ),
  read("../src/shared/config/routes.ts"),
  read("../src/features/admin/config/adminPermissions.ts"),
  read("../src/app/router.tsx"),
  read(
    "../src/features/admin/championships/pages/AdminChampionshipReservationsPage.tsx",
  ),
  read(
    "../src/features/admin/championships/services/championshipReservationService.ts",
  ),
  read("../src/features/reservations/domain/calendar.ts"),
  read("../src/features/reservations/services/reservationCalendarService.ts"),
  read("../src/features/reservations/pages/ReservationsPage.tsx"),
]);

test("configure un droit championnat indépendant des horaires publics", () => {
  assert.match(migration, /championship_reservation_settings/);
  assert.match(migration, /championship_reservation_resources/);
  assert.match(migration, /championship_reservation_windows/);
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /advance_days integer not null default 90/);
  assert.match(migration, /championship_periods as/);
  assert.match(migration, /union\s+select \* from championship_periods/);
});

test("déduit l'éligibilité de l'effectif réel du championnat", () => {
  assert.match(migration, /championship_team_players/);
  assert.match(migration, /player\.profile_id = target_user_id/);
  assert.match(migration, /player\.link_status in \('claimed', 'verified'\)/);
  assert.match(migration, /federation_club\.linked_club_id = target_club_id/);
  assert.match(
    migration,
    /championship\.status in \('preparation', 'active'\)/,
  );
});

test("le serveur contrôle le passe-droit même hors horaires publics", () => {
  assert.match(migration, /assert_reservation_slot_allowed/);
  assert.match(migration, /regular_opening_allowed/);
  assert.match(migration, /championship_access\.is_priority/);
  assert.match(migration, /effective_advance_hours/);
  assert.match(migration, /effective_max_active/);
});

test("l'administration expose des réglages souples", () => {
  assert.match(routes, /adminChampionshipReservations/);
  assert.match(navigation, /Réservations championnat/);
  assert.match(router, /AdminChampionshipReservationsPage/);
  assert.match(adminPage, /17:30/);
  assert.match(adminPage, /21:30/);
  assert.match(adminPage, /Dimanche/);
  assert.match(adminPage, /Réservable combien de jours à l’avance/);
  assert.match(service, /admin_save_championship_reservation_settings/);
});

test("le calendrier distingue visuellement les créneaux championnat", () => {
  assert.match(migration, /reservation_access text/);
  assert.match(migration, /then 'championship' else 'standard'/);
  assert.match(calendar, /reservationAccess\?: "standard" \| "championship"/);
  assert.match(calendarService, /reservation_access/);
  assert.match(calendarService, /reservationAccess: slot\.reservation_access/);
  assert.match(reservationsPage, /Réserver · Championnat/);
  assert.match(reservationsPage, /Accès championnat actif/);
});
