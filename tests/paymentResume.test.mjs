import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = await readFile(
  new URL(
    "../src/features/reservations/services/myReservationsService.ts",
    import.meta.url,
  ),
  "utf8",
);

const page = await readFile(
  new URL(
    "../src/features/reservations/pages/MyReservationsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("reprendre un paiement tient compte du mode de paiement actif", () => {
  assert.match(service, /supabase\.rpc\(\s*"get_payment_mode"/);
  assert.match(service, /paymentMode !== "helloasso"/);
  assert.match(service, /supabase\.rpc\("simulate_payment"/);
  assert.match(service, /simulated_outcome: "paid"/);
});

test("en mode test une interruption laisse le paiement en attente", () => {
  assert.match(service, /Annuler : laisser le paiement en attente/);
  assert.match(service, /return \{ redirectUrl: null, paymentUpdated: false \}/);
  assert.match(page, /Le paiement reste en attente/);
});

test("en mode HelloAsso la reprise réutilise le checkout existant ou en crée un si nécessaire", () => {
  assert.match(service, /if \(reservation\.paymentRedirectUrl\)/);
  assert.match(service, /supabase\.functions\.invoke\("create-helloasso-checkout"/);
});
