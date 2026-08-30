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

const expectMatch = (source, pattern) => {
  assert.match(source, pattern);
};

test("ajoute les paiements partagés", () => {
  expectMatch(migration, /payment_plan in \('full', 'split'\)/);
  expectMatch(migration, /add column if not exists payer_profile_id uuid/);
  expectMatch(
    migration,
    /payments_reservation_payer_unique[\s\S]*reservation_id, payer_profile_id/,
  );
  expectMatch(migration, /payment_plan = 'full'/);
  expectMatch(migration, /payment_plan = 'split'/);
});

test("impose trois autres comptes actifs", () => {
  expectMatch(migration, /array_length\(partner_profile_ids, 1\), 0\) <> 3/);
  expectMatch(migration, /count\(distinct candidate\)[\s\S]*<> 3/);
  expectMatch(migration, /actor_id = any\(partner_profile_ids\)/);
  expectMatch(
    migration,
    /join public\.club_members as member[\s\S]*member\.club_id = target_club_id[\s\S]*member\.is_active/,
  );
  expectMatch(
    migration,
    /join public\.profiles as profile on profile\.member_id = member\.id/,
  );
  expectMatch(
    migration,
    /joueurs sélectionnés doivent posséder un compte Pelote Manager actif/,
  );
});

test("crée quatre parts avec un payeur chacune", () => {
  expectMatch(migration, /created_reservation\.price_cents \/ 4/);
  expectMatch(
    migration,
    /actor_amount := created_reservation\.price_cents - \(partner_amount \* 3\)/,
  );
  expectMatch(
    migration,
    /payer_profile_id,[\s\S]*actor_id,[\s\S]*actor_amount/,
  );
  expectMatch(
    migration,
    /for partner_id in[\s\S]*unnest\(partner_profile_ids\)[\s\S]*payer_profile_id,[\s\S]*partner_id,[\s\S]*partner_amount/,
  );
  expectMatch(
    migration,
    /perform public\.publish_reservation_share_payment_request\(partner_payment\.id\)/,
  );
});

test("confirme seulement après les quatre paiements", () => {
  expectMatch(
    migration,
    /if payment_count > 0 and paid_count = payment_count then[\s\S]*status = case[\s\S]*'confirmed'/,
  );
  expectMatch(
    migration,
    /reservation_row\.payment_plan = 'split'[\s\S]*first_expiry is not null[\s\S]*first_expiry <= now\(\)/,
  );
  expectMatch(
    migration,
    /reservation_row\.payment_plan = 'full'[\s\S]*coalesce\(has_terminal, false\)/,
  );
});

test("notifie chaque partenaire avec sa propre part", () => {
  expectMatch(migration, /Paiement d’une réservation/);
  expectMatch(migration, /reservation_payment_notification_events/);
  expectMatch(
    migration,
    /format\('\/reservations\/paiement-part\?paymentId=%s', payment_request\.payment_id\)/,
  );
  expectMatch(migration, /payment\.payer_profile_id = auth\.uid\(\)/);
});

test("propose payer tout ou payer sa part", () => {
  expectMatch(reservationsPage, /Payer la totalité/);
  expectMatch(reservationsPage, /Payer ma part/);
  expectMatch(reservationsPage, /selectedPlayers\.length !== 3/);
  expectMatch(reservationsPage, /createSplit/);
  expectMatch(playerSelector, /3 autres joueurs/);
  expectMatch(playerSelector, /compte Pelote Manager/);
  expectMatch(playerSelector, /selectedPlayers\.length >= 3/);
});

test("renvoie le paiement partagé vers sa page dédiée", () => {
  expectMatch(
    checkoutFunction,
    /payment\.payment_plan === "split"[\s\S]*"\/reservations\/paiement-part"/,
  );
  expectMatch(sharePaymentPage, /Paiements reçus/);
  expectMatch(sharePaymentPage, /Votre part est réglée/);
  expectMatch(sharePaymentPage, /Réessayer/);
  expectMatch(sharePaymentPage, /ROUTES\.myNotifications/);
});
