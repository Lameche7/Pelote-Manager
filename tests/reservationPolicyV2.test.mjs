import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const optionalPaymentMigration =
  "../supabase/migrations/20260813091500_optional_online_payment.sql";
const notificationMigration =
  "../supabase/migrations/20260813091600_notify_released_reservation_slots.sql";
const projectionMigration =
  "../supabase/migrations/20260813091700_update_my_reservations_projection.sql";

test("le paiement en ligne est optionnel et désactivé par défaut", async () => {
  const migration = await read(optionalPaymentMigration);

  assert.match(
    migration,
    /online_payment_enabled boolean not null default false/i,
  );
  assert.match(migration, /cancellation_notice_hours = 8/i);
  assert.match(migration, /payment_required boolean not null default false/i);
  assert.match(migration, /get_online_payment_enabled/);
  assert.match(migration, /create_reservation_record/);
  assert.match(
    migration,
    /if not \(select online_payment_enabled from public\.reservation_settings where id\)[\s\S]*Le paiement en ligne est désactivé/i,
  );
  assert.match(
    migration,
    /new_online_payment_enabled boolean[\s\S]*online_payment_enabled = new_online_payment_enabled/i,
  );
});

test("l annulation client respecte H-8 jusque dans le RPC générique", async () => {
  const migration = await read(notificationMigration);

  assert.match(
    migration,
    /create or replace function public\.cancel_reservation/i,
  );
  assert.match(migration, /if not actor_is_admin/i);
  assert.match(
    migration,
    /existing_reservation\.starts_at - make_interval\(hours => notice_hours\)/i,
  );
  assert.match(migration, /Le délai d’annulation en ligne est dépassé/i);
  assert.match(
    migration,
    /cancelled_row := public\.cancel_reservation[\s\S]*Annulation en ligne par le réservant/i,
  );
});

test("une annulation notifie les licenciés actifs du club", async () => {
  const migration = await read(notificationMigration);

  assert.match(migration, /Créneau libéré/);
  assert.match(migration, /public\.club_communications/);
  assert.match(migration, /public\.communication_deliveries/);
  assert.match(migration, /member\.is_active/);
  assert.match(migration, /member\.club_id = resource_row\.club_id/);
  assert.match(migration, /expires_at/);
  assert.match(
    migration,
    /perform public\.publish_released_reservation_slot_notification/i,
  );
});

test("Mes réservations distingue les réservations sans paiement", async () => {
  const migration = await read(projectionMigration);

  assert.match(
    migration,
    /drop function if exists public\.list_my_reservations\(\)/i,
  );
  assert.match(migration, /payment_required boolean/i);
  assert.match(migration, /reservation\.payment_required/i);
  assert.match(
    migration,
    /reservation\.starts_at - make_interval\(hours => settings\.cancellation_notice_hours\)/i,
  );
});

test("l interface réserve directement et garde la réactivation admin", async () => {
  const [bookingPage, bookingService, adminPage, adminService] =
    await Promise.all([
      read("../src/features/reservations/pages/ReservationsPage.tsx"),
      read(
        "../src/features/reservations/services/reservationBookingService.ts",
      ),
      read("../src/features/admin/pages/AdminReservationsPage.tsx"),
      read("../src/features/admin/services/adminReservationService.ts"),
    ]);

  assert.match(bookingPage, /paymentEnabled/);
  assert.match(bookingPage, /: "Réserver"/);
  assert.match(bookingService, /get_online_payment_enabled/);
  assert.match(bookingService, /createDirect/);
  assert.match(adminPage, /Paiement en ligne/);
  assert.match(adminPage, /Désactivé — réservation directe/);
  assert.match(adminPage, /Délai d’annulation \(heures avant\)/);
  assert.match(adminService, /onlinePaymentEnabled/);
  assert.match(adminService, /cancellationNoticeHours/);
});

test("Mon profil distingue licence active inactive et non licencié", async () => {
  const [profilePage, profileService] = await Promise.all([
    read("../src/features/user-space/profile/pages/MyProfilePage.tsx"),
    read("../src/features/user-space/profile/services/memberProfileService.ts"),
  ]);

  assert.match(profileService, /is_active/);
  assert.match(profilePage, /Licencié actif/);
  assert.match(profilePage, /Licence inactive/);
  assert.match(profilePage, /Utilisateur non licencié/);
});

test("Mes réservations masque les actions de paiement quand il n est pas requis", async () => {
  const [page, service] = await Promise.all([
    read("../src/features/reservations/pages/MyReservationsPage.tsx"),
    read("../src/features/reservations/services/myReservationsService.ts"),
  ]);

  assert.match(service, /paymentRequired/);
  assert.match(page, /reservation\.paymentRequired/);
  assert.match(page, /les licenciés ont été notifiés/);
});
