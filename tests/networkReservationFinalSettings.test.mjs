import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930090000_remove_reservation_settings_singleton_readers.sql",
    import.meta.url,
  ),
  "utf8",
);

test("aucune fonction du lot final ne lit le singleton historique", () => {
  assert.doesNotMatch(migration, /public\.reservation_settings/);
  assert.match(migration, /public\.club_reservation_settings/);
});

test("TV, permanents et championnat utilisent le club concerné", () => {
  assert.match(migration, /reservation_settings\.club_id = settings\.club_id/);
  assert.match(migration, /settings\.club_id = target_club_id/);
  assert.match(migration, /global_settings\.club_id = club_link\.club_id/);
});

test("la simulation de paiement distingue réservation et licence", () => {
  assert.match(migration, /payment_row\.payment_context = 'reservation'/);
  assert.match(migration, /payment_row\.payment_context = 'licence'/);
  assert.match(migration, /campaign\.payment_mode/);
  assert.match(migration, /settings\.payment_mode/);
});

test("les anciennes RPC refusent une ambiguïté multi-clubs", () => {
  assert.match(migration, /Resource selection required/);
  assert.match(migration, /having count\(\*\) = 1/);
});
