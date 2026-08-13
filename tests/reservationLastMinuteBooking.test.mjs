import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../supabase/migrations/20260813091800_allow_last_minute_reservations.sql",
  import.meta.url,
);

test("les réservations sont autorisées jusqu'au début du créneau", async () => {
  const sql = await readFile(migration, "utf8");

  assert.match(sql, /minimum_notice_minutes = 0/i);
});
