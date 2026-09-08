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

test("reprendre un paiement recrée un checkout au lieu de réutiliser un ancien lien", () => {
  assert.match(service, /async resumePayment\(reservation: MyReservation\)/);
  assert.match(service, /supabase\.functions\.invoke\("create-helloasso-checkout"/);
  assert.doesNotMatch(
    service,
    /if \(reservation\.paymentRedirectUrl\) return reservation\.paymentRedirectUrl/,
  );
});
