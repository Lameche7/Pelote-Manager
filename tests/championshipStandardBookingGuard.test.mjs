import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260917141000_block_standard_booking_on_championship_slots.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les réservations standards sont bloquées sur un créneau championnat", () => {
  assert.match(migration, /assert_not_championship_only_slot/);
  assert.match(migration, /reservation_access = 'championship'/);
  assert.match(
    migration,
    /public\.create_reservation\(uuid,timestamptz,text,text,text\)/,
  );
  assert.match(
    migration,
    /public\.reserve_for_payment\(uuid,timestamptz,text,text,text\)/,
  );
  assert.match(
    migration,
    /public\.reserve_for_split_payment\(uuid,timestamptz,uuid\[\]\)/,
  );
  assert.match(migration, /Mes championnats/);
});
