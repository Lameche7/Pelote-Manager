import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("les dates des phases finales conservent les disponibilités hors période", async () => {
  const migration = await read(
    "../supabase/migrations/20261103193000_preserve_tournament_finals_availability.sql",
  );

  assert.match(migration, /admin_set_tournament_finals_dates/);
  assert.match(migration, /has_club_permission\(target_club_id, 'tournaments\.manage'\)/);
  assert.match(migration, /tournament_final_planning_nodes/);
  assert.match(migration, /tournament_match_planning/);
  assert.doesNotMatch(migration, /raise exception 'Tournament finals dates conflict with existing availability'/);
  assert.doesNotMatch(migration, /delete from public\.tournament_team_availability_slots/);
  assert.match(migration, /ends_on = target_finals_ends_on/);
});
