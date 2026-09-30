import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930083000_network_reservation_core_settings.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le moteur cœur ne lit plus le singleton de réservation", () => {
  assert.doesNotMatch(migration, /public\.reservation_settings/);
  assert.match(migration, /public\.club_reservation_settings/);
});

test("les conditions de réservation sont résolues depuis la ressource", () => {
  assert.match(
    migration,
    /get_reservation_terms_for_resource\(\s*target_resource_id/,
  );
  assert.match(
    migration,
    /get_reservation_terms_for_resource\(\s*slot\.resource_id/,
  );
});

test("le plafond de réservations actives est limité au club cible", () => {
  assert.match(
    migration,
    /active_resource\.club_id = target_club_id/,
  );
});

test("les opérations admin sont limitées au club courant", () => {
  assert.match(
    migration,
    /admin_current_club_id\(\) is distinct from target_club_id/,
  );
  assert.match(migration, /reservations\.manage/);
});

test("annulation et liste Mes réservations utilisent le club de la ressource", () => {
  assert.match(
    migration,
    /settings\.club_id = resource\.club_id/,
  );
  assert.match(
    migration,
    /settings\.club_id = target_club_id/,
  );
});
