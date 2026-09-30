import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930080000_add_club_reservation_settings.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = fs.readFileSync(
  new URL(
    "../src/features/reservations/services/reservationBookingService.ts",
    import.meta.url,
  ),
  "utf8",
);
const page = fs.readFileSync(
  new URL(
    "../src/features/reservations/pages/ReservationsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("les paramètres de réservation sont stockés par club", () => {
  assert.match(migration, /create table if not exists public\.club_reservation_settings/);
  assert.match(migration, /club_id uuid primary key/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /after insert on public\.clubs/);
});

test("les conditions de réservation sont résolues depuis la ressource", () => {
  assert.match(migration, /get_reservation_terms_for_resource/);
  assert.match(migration, /resource\.club_id/);
  assert.match(migration, /is_active_licensee_for_club/);
  assert.match(migration, /club_reservation_settings/);
});

test("la configuration de paiement est résolue par ressource ou paiement", () => {
  assert.match(migration, /get_reservation_payment_config\(/);
  assert.match(migration, /get_reservation_payment_config_for_payment/);
  assert.match(
    migration,
    /payment\.payer_profile_id = auth\.uid\(\)\s+or reservation\.user_id = auth\.uid\(\)/,
  );
});

test("le front ne dépend plus des RPC globales pour le parcours principal", () => {
  assert.match(service, /get_current_reservation_terms_for_resource/);
  assert.match(service, /get_reservation_payment_config/);
  assert.match(service, /get_reservation_payment_config_for_payment/);
  assert.doesNotMatch(service, /supabase\.rpc\("get_current_reservation_terms"/);
  assert.doesNotMatch(service, /supabase\.rpc\("get_online_payment_enabled"/);
  assert.doesNotMatch(service, /supabase\.rpc\("get_payment_mode"/);
  assert.match(page, /getTerms\(resource\.id, slot\.startsAt\)/);
  assert.match(page, /getPaymentConfig\(resource\.id\)/);
});
