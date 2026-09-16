import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const visibilityMigration = await readFile(
  new URL(
    "../supabase/migrations/20260916130000_show_permanent_slots_in_reservations.sql",
    import.meta.url,
  ),
  "utf8",
);

const labelMigration = await readFile(
  new URL(
    "../supabase/migrations/20260916131500_show_permanent_slot_labels_in_reservations.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les créneaux permanents actifs sont visibles dans Réservations", () => {
  assert.match(visibilityMigration, /active_permanent_occurrences/);
  assert.match(
    visibilityMigration,
    /'scheduled'::public\.permanent_slot_occurrence_status/,
  );
  assert.match(
    visibilityMigration,
    /'confirmed'::public\.permanent_slot_occurrence_status/,
  );
  assert.match(
    visibilityMigration,
    /when permanent\.occupation_id is not null then 'permanent_slot'/,
  );
  assert.match(visibilityMigration, /permanent_slots_outside_schedule/);
});

test("le libellé métier du créneau permanent est affiché dans Réservations", () => {
  assert.match(labelMigration, /permanent_slot\.label as permanent_label/);
  assert.match(
    labelMigration,
    /coalesce\(slot\.permanent_label, slot\.booked_by_name, 'Créneau permanent'\)/,
  );
});

test("les autres occupations privées restent masquées et les créneaux libérés restent disponibles", () => {
  assert.match(
    labelMigration,
    /coalesce\(slot\.occupation_type, ''\) <> 'private_use'/,
  );
  assert.match(labelMigration, /released_slots_outside_schedule/);
  assert.match(labelMigration, /'available'::text as status/);
});
