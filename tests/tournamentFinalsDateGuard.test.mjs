import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("un simple changement des dates finales ne réapplique pas le minimum historique", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/20261103200000_allow_finals_date_only_edits_guard.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(sql, /enforce_tournament_finals_availability_for_teams/);
  assert.match(
    sql,
    /new\.minimum_finals_availability_slots is not distinct from old\.minimum_finals_availability_slots/,
  );
  assert.match(sql, /new\.pool_ends_on is not distinct from old\.pool_ends_on/);
  assert.match(
    sql,
    /new\.slot_duration_minutes is not distinct from old\.slot_duration_minutes/,
  );
  assert.match(sql, /return new;/);
  assert.match(sql, /assert_tournament_team_finals_availability/);
});
