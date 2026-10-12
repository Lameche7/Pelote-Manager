import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sync = fs.readFileSync(
  "supabase/functions/championship-official-sync/index.ts",
  "utf8",
);

test("la synchronisation découpe les sources officielles par série", () => {
  assert.match(sync, /const fetchPartitionedSource = async/);
  assert.match(sync, /divisions: \[division\]/);
  assert.match(sync, /body\.divisions\.slice\(index, index \+ 2\)/);
  for (const field of ["results", "standings", "generalStandings"]) {
    assert.match(sync, new RegExp(`"${field}",\\n\\s+warnings`));
  }
});

test("un échec de série est journalisé sans bloquer les autres séries", () => {
  assert.match(sync, /let lastError: unknown/);
  assert.match(sync, /warnings\.push\(/);
  assert.match(sync, /return succeeded > 0/);
});
