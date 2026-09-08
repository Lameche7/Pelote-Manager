import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260908124500_improve_payment_cancellation_admin_cleanup.sql",
    import.meta.url,
  ),
  "utf8",
);
const adminPage = await readFile(
  new URL("../src/features/admin/pages/AdminPaymentsPage.tsx", import.meta.url),
  "utf8",
);

test("une réservation en attente de paiement reste annulable jusqu'au début", () => {
  assert.match(migration, /reservation\.status = 'pending'/);
  assert.match(migration, /open_payment\.status in \('pending', 'authorized'\)/);
  assert.match(migration, /reservation\.starts_at > now\(\)/);
});

test("l'annulation ferme toutes les parts ouvertes et libère le terrain", () => {
  assert.match(migration, /payment\.status in \('pending', 'authorized'\)/);
  assert.match(migration, /update public\.calendar_occupations/);
  assert.match(migration, /cancelled_at = coalesce\(occupation\.cancelled_at, now\(\)\)/);
});

test("la suppression destructive est limitée au mode test sans référence fournisseur", () => {
  assert.match(migration, /settings\.payment_mode.*'test'/s);
  assert.match(migration, /provider_checkout_intent_id is not null/);
  assert.match(migration, /provider_order_id is not null/);
  assert.match(migration, /provider_payment_id is not null/);
});

test("l'administration expose annulation et suppression test", () => {
  assert.match(adminPage, /Annuler la réservation/);
  assert.match(adminPage, /Supprimer le test/);
  assert.match(adminPage, /adminPaymentService\.cancelReservation/);
  assert.match(adminPage, /adminPaymentService\.deleteTest/);
});