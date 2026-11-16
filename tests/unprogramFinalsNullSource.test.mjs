import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261116124500_unprogram_finals_null_source.sql",
    import.meta.url,
  ),
  "utf8",
);

test("unprogram clears the entire finals scheduling tuple", () => {
  assert.match(migration, /admin_unprogram_tournament_match\(uuid,text\)/);
  assert.match(migration, /source=''manual'',updated_at=now\(\)/);
  assert.match(migration, /source=null,updated_at=now\(\)/);
  assert.match(migration, /Expected finals unprogramming statement not found/);
  assert.match(migration, /commit;\s*$/);
});
