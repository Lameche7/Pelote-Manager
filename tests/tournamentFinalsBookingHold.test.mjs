import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261111220000_block_tournament_finals_unplanned_reservations.sql",
    import.meta.url,
  ),
  "utf8",
);

test("only configured finals slots inside finals dates are held", () => {
  assert.match(sql, /generated\.phase = 'finals'/);
  assert.match(
    sql,
    /generated\.play_date between tournament\.finals_starts_on and tournament\.finals_ends_on/,
  );
  assert.match(sql, /tstzrange\(/);
});

test("calendar shows an unavailable finals hold", () => {
  assert.match(sql, /tournament_finals_hold/);
  assert.match(sql, /Réservé – Phases finales du tournoi/);
});

test("all three standard booking entrypoints reject finals holds", () => {
  assert.match(
    sql,
    /public\.create_reservation\(uuid,timestamptz,text,text,text\)/,
  );
  assert.match(
    sql,
    /public\.reserve_for_payment\(uuid,timestamptz,text,text,text\)/,
  );
  assert.match(
    sql,
    /public\.reserve_for_split_payment\(uuid,timestamptz,uuid\[\]\)/,
  );
  assert.match(sql, /assert_not_tournament_finals_slot/);
});
