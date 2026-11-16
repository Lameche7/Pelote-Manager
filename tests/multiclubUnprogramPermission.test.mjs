import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL(
  "../supabase/migrations/20261116120000_multiclub_tournament_unprogram_permission.sql",
  import.meta.url,
), "utf8");

test("unprogram checks permission in the match's tournament club", () => {
  assert.match(migration, /public\.admin_unprogram_tournament_match\(uuid,text\)/);
  assert.match(migration, /public\.has_club_permission\(t\.club_id,''tournaments\.manage''\)/);
  assert.match(migration, /old_guard :=/);
  assert.match(migration, /new_guard :=/);
  assert.match(migration, /Expected legacy single-club authorization guard not found/);
  assert.match(migration, /commit;\s*$/);
});
