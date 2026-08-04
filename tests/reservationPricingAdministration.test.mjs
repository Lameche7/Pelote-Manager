import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20260804000000_connect_club_prices_to_reservations.sql",
  "utf8",
);
const reservationCommands = fs.readFileSync(
  "supabase/migrations/20260728000400_add_reservation_commands.sql",
  "utf8",
);
const page = fs.readFileSync(
  "src/features/admin/club/pages/ClubCollectionsPage.tsx",
  "utf8",
);
const service = fs.readFileSync(
  "src/features/admin/club/services/clubAdminService.ts",
  "utf8",
);

function functionBody(source, name) {
  const start = source.indexOf(`function public.${name}`);
  assert.notEqual(start, -1, `${name} doit exister`);
  const end = source.indexOf("$$;", start);
  return source.slice(start, end + 3);
}

test("l'onglet Tarifs lit les montants réellement utilisés par les réservations", () => {
  assert.match(page, /getReservationPrices/);
  assert.match(page, /updateReservationPrices/);
  assert.doesNotMatch(page, /createPrice/);
  assert.doesNotMatch(page, /deletePrice/);
  assert.match(service, /admin_get_reservation_prices/);
  assert.match(service, /admin_update_reservation_prices/);
});

test("seule la permission de tarification peut consulter et modifier les montants", () => {
  for (const name of [
    "admin_get_reservation_prices",
    "admin_update_reservation_prices",
  ]) {
    const sql = functionBody(migration, name);
    assert.match(sql, /admin_current_club_id/);
    assert.match(sql, /has_club_permission/);
    assert.match(sql, /'pricing\.manage'/);
  }
});

test("la modification met à jour la source de vérité du moteur de réservation", () => {
  const update = functionBody(migration, "admin_update_reservation_prices");
  assert.match(update, /update public\.reservation_settings/);
  assert.match(update, /licensee_price_cents = new_licensee_price_cents/);
  assert.match(update, /public_price_cents = new_public_price_cents/);

  const terms = functionBody(reservationCommands, "get_reservation_terms");
  assert.match(terms, /settings\.licensee_price_cents/);
  assert.match(terms, /settings\.public_price_cents/);
});

test("le prix calculé est figé dans chaque nouvelle réservation", () => {
  const createReservation = functionBody(
    reservationCommands,
    "create_reservation",
  );
  assert.match(createReservation, /price_cents/);
  assert.match(createReservation, /terms\.price_cents/);
});

test("les deux tarifs sont clairement distingués dans l'administration", () => {
  assert.match(page, /Tarif licencié actif/);
  assert.match(page, /Tarif visiteur ou compte non licencié/);
  assert.match(page, /licence active\s*et validée/);
});
