import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  baseMigration,
  paymentMigration,
  securityMigration,
  calendarService,
  reservationPage,
  championshipsPage,
  championshipsService,
  matchReservationService,
  adminReservationPage,
  adminReservationService,
  resultSettingsCard,
  tvService,
] = await Promise.all([
  read("../supabase/migrations/20260916143000_add_championship_match_reservations.sql"),
  read("../supabase/migrations/20260916144000_configure_championship_match_payments.sql"),
  read("../supabase/migrations/20260916144100_secure_championship_match_reservations.sql"),
  read("../src/features/reservations/services/reservationCalendarService.ts"),
  read("../src/features/reservations/pages/ReservationsPage.tsx"),
  read("../src/features/user-space/championships/pages/MyChampionshipsPage.tsx"),
  read("../src/features/user-space/championships/services/myChampionshipsService.ts"),
  read("../src/features/user-space/championships/services/championshipMatchReservationService.ts"),
  read("../src/features/admin/championships/pages/AdminChampionshipReservationsPage.tsx"),
  read("../src/features/admin/championships/services/championshipReservationService.ts"),
  read("../src/features/admin/championships/components/ChampionshipResultSettingsCard.tsx"),
  read("../src/features/tv/services/tvDisplayService.ts"),
]);

test("une réservation peut être rattachée à une rencontre et décorée par série", () => {
  assert.match(baseMigration, /championship_match_id uuid/);
  assert.match(baseMigration, /display_color text/);
  assert.match(baseMigration, /list_available_slots_v3/);
  assert.match(baseMigration, /'championship_match'/);
  assert.match(baseMigration, /get_public_tv_championship_slot_decorations/);
  assert.match(calendarService, /list_available_slots_v3/);
});

test("le paiement des rencontres est paramétrable par club", () => {
  assert.match(paymentMigration, /match_payment_mode text not null default 'free'/);
  assert.match(paymentMigration, /'free', 'standard'/);
  assert.match(paymentMigration, /admin_save_championship_reservation_settings_v2/);
  assert.match(paymentMigration, /CHAMPIONSHIP_PAYMENT_REQUIRED/);
  assert.match(paymentMigration, /reserve_my_championship_match_for_payment/);
  assert.match(adminReservationPage, /Sans paiement/);
  assert.match(adminReservationPage, /Tarification habituelle du club/);
  assert.match(adminReservationService, /target_match_payment_mode/);
});

test("le PCL peut réserver gratuitement sans contourner les contrôles de club", () => {
  assert.match(paymentMigration, /price_cents, payment_required/);
  assert.match(paymentMigration, /target_match_id/);
  assert.match(securityMigration, /validate_championship_match_reservation/);
  assert.match(securityMigration, /federation_club\.linked_club_id = target_club_id/);
});

test("Mes championnats ouvre Réservations avec le contexte de la rencontre", () => {
  assert.match(championshipsPage, /Réserver un terrain pour cette rencontre/);
  assert.match(championshipsPage, /championshipMatch/);
  assert.match(championshipsPage, /match\.reservation/);
  assert.match(championshipsService, /get_my_championship_match_reservations/);
  assert.match(reservationPage, /Réservation pour une rencontre/);
  assert.match(reservationPage, /championshipMatchReservationService\.create/);
  assert.match(matchReservationService, /get_my_championship_reservation_context/);
});

test("les couleurs de série restent administratives et alimentent Réservations et TV", () => {
  assert.match(resultSettingsCard, /Couleurs des séries/);
  assert.match(resultSettingsCard, /type="color"/);
  assert.match(resultSettingsCard, /Réservations et le Mode TV/);
  assert.match(tvService, /get_public_tv_championship_slot_decorations/);
  assert.match(tvService, /mapChampionshipDecoration/);
});
