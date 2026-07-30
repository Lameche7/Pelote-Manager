import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPrice,
  getBookingErrorMessage,
} from "../.test-dist/src/features/reservations/domain/booking.js";

test("formate les tarifs en euros pour la France", () => {
  assert.match(formatPrice(1200), /12,00\s?€/);
  assert.match(formatPrice(1800), /18,00\s?€/);
});

test("traduit les conflits de réservation en message utilisateur", () => {
  assert.equal(
    getBookingErrorMessage(new Error("Ce créneau est déjà occupé")),
    "Ce créneau vient d’être réservé. Le calendrier a été actualisé.",
  );
});

test("traduit les limites de quota en message utilisateur", () => {
  assert.equal(
    getBookingErrorMessage(
      new Error("Le nombre maximal de réservations actives est atteint"),
    ),
    "Vous avez atteint le nombre maximal de réservations actives.",
  );
});
