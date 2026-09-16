import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260916130000_show_permanent_slots_in_reservations.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les créneaux permanents actifs sont visibles sans exposer leur libellé", () => {
  assert.match(migration, /active_permanent_occurrences/);
  assert.match(migration, /'scheduled'::public\.permanent_slot_occurrence_status/);
  assert.match(migration, /'confirmed'::public\.permanent_slot_occurrence_status/);
  assert.match(migration, /when permanent\.occupation_id is not null then 'permanent_slot'/);
  assert.match(migration, /when slot\.is_active_permanent_slot then 'Créneau permanent'/);
  assert.match(migration, /permanent_slots_outside_schedule/);
});

test("les autres occupations privées restent masquées et les créneaux libérés restent disponibles", () => {
  assert.match(migration, /coalesce\(slot\.occupation_type, ''\) <> 'private_use'/);
  assert.match(migration, /released_slots_outside_schedule/);
  assert.match(migration, /'available'::text as status/);
});
