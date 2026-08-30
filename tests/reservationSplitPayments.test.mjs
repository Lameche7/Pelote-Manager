import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260830150000_split_reservation_payments.sql",
  "utf8",
);
const reservationsPage = readFileSync(
  "src/features/reservations/pages/ReservationsPage.tsx",
  "utf8",
);
const playerSelector = readFileSync(
  "src/features/reservations/components/ReservationSplitPaymentFields.tsx",
  "utf8",
);
const sharePaymentPage = readFileSync(
  "src/features/reservations/pages/ReservationSharePaymentPage.tsx",
  "utf8",
);
const checkoutFunction = readFileSync(
  "supabase/functions/create-helloasso-checkout/index.ts",
  "utf8",
);

test("conserve le paiement total et ajoute un plan partagé", () => {
  assert.match(migration, /payment_plan in \('full', 'split'\)/);
  assert.match(migration, /add column if not exists payer_profile_id uuid/);
  assert.match(
    migration,
    /payments_reservation_payer_unique[\s\S]*reservation_id, payer_profile_id/,
  );
  assert.match(migration, /payment_plan = 'full'/);
  assert.match(migration, /payment_plan = 'split'/);
});

test("le paiement partagé impose exactement trois autres comptes actifs du club", () => {
  assert.match(
    migration,
    /array_length\(partner_profile_ids, 1\), 0\) <> 3/,
  );
  assert.match(migration, /count\(distinct candidate\)[\s\S]*<> 3/);
  assert.match(migration, /actor_id = any\(partner_profile_ids\)/);
  assert.match(
    migration,
    /join public\.club_members as member[\s\S]*member\.club_id = target_club_id[\s\S]*member\.is_active/,
  );
  assert.match(
    migration,
    /join public\.profiles as profile on profile\.member_id = member\.id/,
  );
  assert.match(
    migration,
    /joueurs sélectionnés doivent posséder un compte Pelote Manager actif/,
  );
});

test("crée quatre parts et rattache chaque paiement à son payeur", () => {
  assert.match(migration, /created_reservation\.price_cents \/ 4/);
  assert.match(
    migration,
    /actor_amount := created_reservation\.price_cents - \(partner_amount \* 3\)/,
  );
  assert.match(
    migration,
    /payer_profile_id,[\s\S]*actor_id,[\s\S]*actor_amount/,
  );
  assert.match(
    migration,
    /for partner_id in[\s\S]*unnest\(partner_profile_ids\)[\s\S]*payer_profile_id,[\s\S]*partner_id,[\s\S]*partner_amount/,
  );
  assert.match(
    migration,
    /perform public\.publish_reservation_share_payment_request\(partner_payment\.id\)/,
  );
});

test("la réservation partagée n'est confirmée qu'après le paiement de toutes les parts", () => {
  assert.match(
    migration,
    /if payment_count > 0 and paid_count = payment_count then[\s\S]*status = case[\s\S]*'confirmed'/,
  );
  assert.match(
    migration,
    /reservation_row\.payment_plan = 'split'[\s\S]*first_expiry is not null[\s\S]*first_expiry <= now\(\)/,
  );
  assert.match(
    migration,
    /reservation_row\.payment_plan = 'full'[\s\S]*coalesce\(has_terminal, false\)/,
  );
});

test("chaque partenaire reçoit un lien Pelote Manager vers sa propre part", () => {
  assert.match(migration, /Paiement d’une réservation/);
  assert.match(migration, /reservation_payment_notification_events/);
  assert.match(
    migration,
    /format\('\/reservations\/paiement-part\?paymentId=%s', payment_request\.payment_id\)/,
  );
  assert.match(migration, /payment\.payer_profile_id = auth\.uid\(\)/);
});

test("l'interface propose payer tout ou payer ma part avec trois joueurs", () => {
  assert.match(reservationsPage, /Payer la totalité/);
  assert.match(reservationsPage, /Payer ma part/);
  assert.match(reservationsPage, /selectedPlayers\.length !== 3/);
  assert.match(reservationsPage, /createSplit/);
  assert.match(playerSelector, /3 autres joueurs/);
  assert.match(playerSelector, /compte Pelote Manager/);
  assert.match(playerSelector, /selectedPlayers\.length >= 3/);
});

test("HelloAsso revient sur la page dédiée pour un paiement partagé", () => {
  assert.match(
    checkoutFunction,
    /payment\.payment_plan === "split"[\s\S]*"\/reservations\/paiement-part"/,
  );
  assert.match(sharePaymentPage, /Paiements reçus/);
  assert.match(sharePaymentPage, /Votre part est réglée/);
  assert.match(sharePaymentPage, /Réessayer/);
  assert.match(sharePaymentPage, /ROUTES\.myNotifications/);
});
