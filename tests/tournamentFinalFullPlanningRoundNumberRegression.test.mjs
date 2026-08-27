import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260827201000_fix_full_final_planning_round_number_ambiguity.sql",
    import.meta.url,
  ),
  "utf8",
);

test("full finals planning grid does not shadow the round_number column", () => {
  assert.match(migration, /current_round_number integer;/);
  assert.doesNotMatch(migration, /\n\s*round_number integer;/);
  assert.match(
    migration,
    /on conflict on constraint tournament_final_planning_nodes_pkey\s+do nothing;/g,
  );
});
