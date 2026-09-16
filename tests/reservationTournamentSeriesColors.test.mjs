import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260916122000_fix_reservation_tournament_slot_type.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les créneaux de tournoi sont identifiés comme match dans Réservations", () => {
  assert.match(migration, /when series\.id is not null then 'match'/);
  assert.match(migration, /series\.color as display_color/);
  assert.match(migration, /list_available_slots_v2/);
});
